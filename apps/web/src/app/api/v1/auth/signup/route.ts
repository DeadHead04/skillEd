import {
  accountDb as sql,
  accountSchemaReady,
  SignupSchema,
  digestToken,
  hashPassword,
  invalidLink,
  accessError,
} from "../../../../../lib/account-access";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const parsed = SignupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return accessError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Check your signup details.",
    );
  const input = parsed.data;
  try {
    await accountSchemaReady();
    const passwordHash = await hashPassword(input.password);
    const user = await sql.begin(async (tx) => {
      const [invitation] =
        await tx`SELECT t.* FROM account_tokens t JOIN users creator ON creator.id=t.created_by WHERE t.token_hash=${digestToken(input.token)} AND t.kind='invitation' AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>now() AND creator.active AND creator.role='administrator' FOR UPDATE OF t`;
      if (!invitation) return null;
      const [created] =
        await tx`INSERT INTO users(login_id,display_name,role,password_hash) VALUES(${input.loginId},${input.displayName},${invitation.role},${passwordHash}) RETURNING id,login_id`;
      await tx`UPDATE account_tokens SET used_at=now() WHERE id=${invitation.id}`;
      await tx`INSERT INTO user_audit_events(actor_user_id,target_user_id,action,detail) VALUES(${invitation.created_by},${created!.id},'invitation_accepted',${tx.json({ invitationId: invitation.id, role: invitation.role })})`;
      return created;
    });
    return user
      ? Response.json(
          { created: true, loginId: user.login_id },
          { status: 201, headers: { "cache-control": "no-store" } },
        )
      : invalidLink();
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      return accessError(
        "LOGIN_ID_EXISTS",
        "This login ID is already taken. Choose a different one; your invitation is still available.",
        409,
      );
    return accessError(
      "ACCOUNT_UNAVAILABLE",
      "Account creation could not be confirmed. Try signing in if you already submitted, or retry when the service is available.",
      503,
    );
  }
}
