import { NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE } from "../../../../../lib/auth";

export async function POST(request: Request) {
  const { password } = (await request.json()) as { password?: string };
  const expected = process.env.SKILLED_ADMIN_PASSWORD ?? "";
  const sessionSecret = process.env.SKILLED_SESSION_SECRET ?? "";
  if (!expected || sessionSecret.length < 32)
    return NextResponse.json(
      {
        code: "AUTH_NOT_CONFIGURED",
        title: "Local authentication is not configured",
        detail:
          "Set SKILLED_ADMIN_PASSWORD and a SKILLED_SESSION_SECRET of at least 32 characters.",
        retryable: false,
        correlationId: crypto.randomUUID(),
      },
      { status: 503 },
    );
  let different = Number(!password || password.length !== expected.length);
  const candidate = password ?? "";
  const length = Math.max(candidate.length, expected.length);
  for (let index = 0; index < length; index++)
    different |=
      (candidate.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);

  if (different !== 0)
    return NextResponse.json(
      {
        code: "INVALID_CREDENTIALS",
        title: "Sign in failed",
        detail: "The local administrator password is incorrect.",
        retryable: false,
        correlationId: crypto.randomUUID(),
      },
      { status: 401 },
    );

  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(
    SESSION_COOKIE,
    await createSessionToken(sessionSecret),
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
