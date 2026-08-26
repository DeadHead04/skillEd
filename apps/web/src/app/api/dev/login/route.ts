import { NextResponse } from "next/server";
import { DEV_COOKIE, devBypassEnabled } from "../../../../lib/authz";

export async function GET(request: Request) {
  if (!devBypassEnabled())
    return new NextResponse("Not found", { status: 404 });
  const response = NextResponse.redirect(
    new URL("/", process.env.APP_URL ?? "http://localhost:3000"),
  );
  const profile = new URL(request.url).searchParams.get("profile");
  response.cookies.set(
    DEV_COOKIE,
    profile === "empty" ? "empty-user" : "dev-user",
    {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
    },
  );
  return response;
}
