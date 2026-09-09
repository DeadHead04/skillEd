import { NextResponse, type NextRequest } from "next/server";
import { db } from "@skilled/core";
import { SESSION_COOKIE, verifySessionToken } from "./lib/auth";

const sql = db();

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const forwarded = new Headers(request.headers);
  for (const key of [...forwarded.keys()])
    if (key.startsWith("x-skilled-")) forwarded.delete(key);
  if (path.startsWith("/api/v1/auth/") || path.startsWith("/api/v1/users")) {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.get("origin");
      let crossOrigin = request.headers.get("sec-fetch-site") === "cross-site";
      if (origin) {
        try {
          crossOrigin ||= new URL(origin).host !== request.headers.get("host");
        } catch {
          crossOrigin = true;
        }
      }
      if (crossOrigin)
        return NextResponse.json(
          {
            code: "ORIGIN_REJECTED",
            detail: "Account changes must come from this SkillEd installation.",
          },
          { status: 403 },
        );
    }
  }
  if (
    path === "/login" ||
    path === "/signup" ||
    path === "/forgot-password" ||
    path === "/reset-password" ||
    path === "/api/v1/auth/login" ||
    path === "/api/v1/auth/signup" ||
    path === "/api/v1/auth/reset-password" ||
    path === "/api/v1/health"
  ) {
    const response = NextResponse.next({ request: { headers: forwarded } });
    response.headers.set("cache-control", "no-store");
    response.headers.set("referrer-policy", "no-referrer");
    return response;
  }

  const claims = await verifySessionToken(
    request.cookies.get(SESSION_COOKIE)?.value,
    process.env.SKILLED_SESSION_SECRET ?? "",
  );
  if (claims) {
    const [user] =
      await sql`SELECT id,login_id,display_name,role,active,session_version,password_change_required FROM users WHERE id=${claims.userId}`;
    if (
      user?.active &&
      Number(user.session_version) === claims.sessionVersion &&
      user.role === claims.role
    ) {
      const headers = forwarded;
      headers.set("x-skilled-user-id", String(user.id));
      headers.set("x-skilled-login-id", String(user.login_id));
      headers.set(
        "x-skilled-display-name",
        encodeURIComponent(String(user.display_name)),
      );
      headers.set("x-skilled-user-role", String(user.role));
      if (
        user.password_change_required &&
        ![
          "/account",
          "/api/v1/auth/password",
          "/api/v1/auth/me",
          "/api/v1/auth/logout",
        ].includes(path)
      ) {
        if (path.startsWith("/api/"))
          return NextResponse.json(
            {
              code: "PASSWORD_CHANGE_REQUIRED",
              detail:
                "Change your temporary password before opening the workbench.",
            },
            { status: 403 },
          );
        return NextResponse.redirect(new URL("/account", request.url));
      }
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
      const response = NextResponse.next({ request: { headers } });
      response.headers.set("cache-control", "no-store");
      response.headers.set("referrer-policy", "same-origin");
      return response;
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
