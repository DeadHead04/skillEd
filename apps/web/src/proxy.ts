import { NextResponse, type NextRequest } from "next/server";
import { db } from "@skilled/core";
import { SESSION_COOKIE, verifySessionToken } from "./lib/auth";

const sql = db();

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (
    path === "/login" ||
    path === "/api/v1/auth/login" ||
    path === "/api/v1/health"
  )
    return NextResponse.next();

  const claims = await verifySessionToken(
    request.cookies.get(SESSION_COOKIE)?.value,
    process.env.SKILLED_SESSION_SECRET ?? "",
  );
  if (claims) {
    const [user] =
      await sql`SELECT id,login_id,display_name,role,active,session_version FROM users WHERE id=${claims.userId}`;
    if (
      user?.active &&
      Number(user.session_version) === claims.sessionVersion &&
      user.role === claims.role
    ) {
      const headers = new Headers(request.headers);
      headers.set("x-skilled-user-id", String(user.id));
      headers.set("x-skilled-login-id", String(user.login_id));
      headers.set(
        "x-skilled-display-name",
        encodeURIComponent(String(user.display_name)),
      );
      headers.set("x-skilled-user-role", String(user.role));
      if (path === "/users" && user.role !== "administrator") {
        const skill = request.nextUrl.clone();
        skill.pathname = "/skill";
        return NextResponse.redirect(skill);
      }
      if (path.startsWith("/api/v1/users") && user.role !== "administrator")
        return NextResponse.json(
          {
            code: "ADMIN_REQUIRED",
            title: "Administrator access required",
            detail: "Only an administrator can manage SkillEd users.",
            retryable: false,
            correlationId: crypto.randomUUID(),
          },
          { status: 403 },
        );
      return NextResponse.next({ request: { headers } });
    }
  }

  if (path.startsWith("/api/"))
    return NextResponse.json(
      {
        code: "AUTH_REQUIRED",
        title: "Sign in required",
        detail: "Your SkillEd session is missing or expired.",
        retryable: false,
        correlationId: crypto.randomUUID(),
      },
      { status: 401 },
    );

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.searchParams.set("next", `${path}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
