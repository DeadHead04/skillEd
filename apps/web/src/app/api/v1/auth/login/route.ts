import { LoginIdSchema, LoginSchema, db, ensureSchema } from "@skilled/core";
import { NextResponse } from "next/server";
import {
  createSessionToken,
  SESSION_COOKIE,
  type SessionRole,
} from "../../../../../lib/auth";

export const runtime = "nodejs";
const sql = db();
let ready: Promise<void> | undefined;

function schemaReady() {
  ready ??= ensureSchema(sql);
  return ready;
}

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
    if (!parsedLogin.success || password.length < 12)
      throw new Error(
        "Set SKILLED_ADMIN_LOGIN_ID and SKILLED_ADMIN_PASSWORD (at least 12 characters) to bootstrap the first administrator.",
      );
    await tx`INSERT INTO users(login_id,display_name,role,password_hash)
      VALUES(${parsedLogin.data},${displayName},'administrator',crypt(${password},gen_salt('bf',12)))`;
  });
}

export async function POST(request: Request) {
  const sessionSecret = process.env.SKILLED_SESSION_SECRET ?? "";
  if (sessionSecret.length < 32)
    return problem(
      "AUTH_NOT_CONFIGURED",
      "Local authentication is not configured",
      "Set SKILLED_SESSION_SECRET to at least 32 characters.",
      503,
    );

  try {
    await schemaReady();
    await bootstrapAdministrator();
  } catch (cause) {
    return problem(
      "AUTH_NOT_CONFIGURED",
      "Local authentication is not configured",
      cause instanceof Error ? cause.message : String(cause),
      503,
    );
  }

  const parsed = LoginSchema.safeParse(await request.json());
  if (!parsed.success)
    return problem(
      "INVALID_CREDENTIALS",
      "Sign in failed",
      "The login ID or password is incorrect.",
      401,
    );
  const { loginId, password } = parsed.data;
  const [attempt] =
    await sql`SELECT failed_count,locked_until FROM auth_login_attempts WHERE login_id=${loginId}`;
  if (attempt?.locked_until && new Date(attempt.locked_until) > new Date())
    return problem(
      "LOGIN_TEMPORARILY_LOCKED",
      "Sign in temporarily locked",
      "Too many failed attempts. Try again in 15 minutes or ask an administrator to reset the password.",
      429,
      true,
    );

  const [user] =
    await sql`SELECT id,login_id,display_name,role,password_hash,active,session_version FROM users WHERE lower(login_id)=lower(${loginId})`;
  let passwordMatches = false;
  if (user) {
    const [verification] =
      await sql`SELECT crypt(${password},${user.password_hash})=${user.password_hash} AS matches`;
    passwordMatches = Boolean(verification?.matches);
  } else {
    await sql`SELECT crypt(${password},gen_salt('bf',12))`;
  }

  if (!user || !user.active || !passwordMatches) {
    const previous =
      attempt?.locked_until && new Date(attempt.locked_until) <= new Date()
        ? 0
        : Number(attempt?.failed_count ?? 0);
    const failedCount = previous + 1;
    const lockedUntil =
      failedCount >= 5 ? new Date(Date.now() + 15 * 60_000) : null;
    await sql`INSERT INTO auth_login_attempts(login_id,failed_count,locked_until,updated_at)
      VALUES(${loginId},${failedCount},${lockedUntil},now())
      ON CONFLICT(login_id) DO UPDATE SET failed_count=excluded.failed_count,locked_until=excluded.locked_until,updated_at=now()`;
    return problem(
      "INVALID_CREDENTIALS",
      "Sign in failed",
      "The login ID or password is incorrect.",
      401,
    );
  }

  await sql.begin(async (tx) => {
    await tx`DELETE FROM auth_login_attempts WHERE login_id=${loginId}`;
    await tx`UPDATE users SET last_login_at=now(),updated_at=now() WHERE id=${user.id}`;
  });

  const role = user.role as SessionRole;
  const response = NextResponse.json({
    authenticated: true,
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
