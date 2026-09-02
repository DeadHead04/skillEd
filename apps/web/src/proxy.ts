import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./lib/auth";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (
    path === "/login" ||
    path === "/api/v1/auth/login" ||
    path === "/api/v1/health"
  )
    return NextResponse.next();

  const valid = await verifySessionToken(
    request.cookies.get(SESSION_COOKIE)?.value,
    process.env.SKILLED_SESSION_SECRET ?? "",
  );
  if (valid) return NextResponse.next();

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
