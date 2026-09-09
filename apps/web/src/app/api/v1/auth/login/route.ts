import { LoginIdSchema, LoginSchema, PasswordSchema } from "@skilled/core";
import {
  accountDb as sql,
  accountSchemaReady,
  hashPassword,
  matchesPassword,
} from "../../../../../lib/account-access";
import { NextResponse } from "next/server";
import {
  createSessionToken,
  SESSION_COOKIE,
  type SessionRole,
} from "../../../../../lib/auth";

export const runtime = "nodejs";

function problem(
  code: string,
  title: string,
  detail: string,
  status: number,
  retryable = false,
) {
  return NextResponse.json(
    {
      code,
      title,
      detail,
      retryable,
      correlationId: crypto.randomUUID(),
    },
    { status },
  );
}

async function bootstrapAdministrator() {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(75642101)`;
    const [count] = await tx`SELECT count(*)::integer AS count FROM users`;
    if (Number(count?.count) > 0) return;
    const password = process.env.SKILLED_ADMIN_PASSWORD ?? "";
    const parsedLogin = LoginIdSchema.safeParse(
      process.env.SKILLED_ADMIN_LOGIN_ID ?? "admin",
    );
    const displayName =
      process.env.SKILLED_ADMIN_DISPLAY_NAME?.trim() || "Local administrator";
    if (!parsedLogin.success || !PasswordSchema.safeParse(password).success)
      throw new Error(
        "Set SKILLED_ADMIN_LOGIN_ID and SKILLED_ADMIN_PASSWORD (at least 12 characters) to bootstrap the first administrator.",
      );
    await tx`INSERT INTO users(login_id,display_name,role,password_hash)
      VALUES(${parsedLogin.data},${displayName},'administrator',${await hashPassword(password)})`;
  });
}

export async function POST(request: Request) {
  const sessionSecret = process.env.SKILLED_SESSION_SECRET ?? "";
  if (
    sessionSecret.length < 32 ||
    (process.env.SKILLED_DEPLOYMENT === "render" &&
      (sessionSecret.includes("local-development") ||
        process.env.SKILLED_HTTPS !== "true"))
  )
    return problem(
      "AUTH_NOT_CONFIGURED",
      "Local authentication is not configured",
      "Set SKILLED_SESSION_SECRET to at least 32 characters.",
      503,
    );

  try {
    await accountSchemaReady();
    await bootstrapAdministrator();
  } catch (cause) {
    return problem(
      "AUTH_NOT_CONFIGURED",
      "Local authentication is not configured",
      cause instanceof Error ? cause.message : String(cause),
      503,
    );
  }

  const parsed = LoginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return problem(
      "INVALID_CREDENTIALS",
      "Sign in failed",
      "The login ID or password is incorrect.",
      401,
    );
  const { loginId, password } = parsed.data;
  const [snapshot] = await sql`SELECT * FROM users WHERE login_id=${loginId}`;
  const passwordMatches = snapshot
    ? await matchesPassword(password, snapshot.password_hash)
    : (await hashPassword(password), false);
  const outcome = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(75642102,hashtext(${loginId}))`;
    const [attempt] =
      await tx`SELECT failed_count,locked_until FROM auth_login_attempts WHERE login_id=${loginId}`;
    if (attempt?.locked_until && new Date(attempt.locked_until) > new Date())
      return { locked: true };
    const [current] =
      await tx`SELECT * FROM users WHERE login_id=${loginId} FOR UPDATE`;
    if (
      !current?.active ||
      !passwordMatches ||
      current.password_hash !== snapshot?.password_hash ||
      current.session_version !== snapshot?.session_version
    ) {
      const count =
        (attempt?.locked_until && new Date(attempt.locked_until) <= new Date()
          ? 0
          : Number(attempt?.failed_count ?? 0)) + 1;
      const until = count >= 5 ? new Date(Date.now() + 15 * 60_000) : null;
      await tx`INSERT INTO auth_login_attempts(login_id,failed_count,locked_until,updated_at) VALUES(${loginId},${count},${until},now()) ON CONFLICT(login_id) DO UPDATE SET failed_count=excluded.failed_count,locked_until=excluded.locked_until,updated_at=now()`;
      return { invalid: true };
    }
    await tx`DELETE FROM auth_login_attempts WHERE login_id=${loginId}`;
    await tx`UPDATE users SET last_login_at=now(),updated_at=now() WHERE id=${current.id}`;
    return { user: current };
  });
  if (outcome.locked)
    return problem(
      "LOGIN_TEMPORARILY_LOCKED",
      "Sign in temporarily locked",
      "Too many failed attempts. Try again in 15 minutes or ask an administrator for a password reset link.",
      429,
      true,
    );
  if (!outcome.user)
    return problem(
      "INVALID_CREDENTIALS",
      "Sign in failed",
      "The login ID or password is incorrect.",
      401,
    );
  const user = outcome.user;

  const role = user.role as SessionRole;
  const response = NextResponse.json({
    authenticated: true,
    passwordChangeRequired: user.password_change_required,
    user: {
      id: user.id,
      loginId: user.login_id,
      displayName: user.display_name,
      role,
    },
  });
  response.cookies.set(
    SESSION_COOKIE,
    await createSessionToken(
      {
        id: String(user.id),
        role,
        sessionVersion: Number(user.session_version),
      },
      sessionSecret,
    ),
    {
      httpOnly: true,
      sameSite: "strict",
      secure:
        process.env.NODE_ENV === "production" &&
        process.env.SKILLED_HTTPS === "true",
      path: "/",
      maxAge: 86_400,
    },
  );
  return response;
}
