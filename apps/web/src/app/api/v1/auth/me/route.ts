import { authenticatedUser } from "../../../../../lib/auth";

export async function GET(request: Request) {
  const user = authenticatedUser(request);
  if (!user)
    return Response.json(
      {
        code: "AUTH_REQUIRED",
        title: "Sign in required",
        detail: "Your SkillEd session is missing or expired.",
        retryable: false,
        correlationId: crypto.randomUUID(),
      },
      { status: 401 },
    );
  return Response.json({ authenticated: true, user });
}
