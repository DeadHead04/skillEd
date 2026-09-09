import {
  accountDb as sql,
  accountSchemaReady,
  ResetSchema,
  digestToken,
  hashPassword,
  invalidLink,
  accessError,
} from "../../../../../lib/account-access";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const parsed = ResetSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return accessError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Check your password.",
    );
  try {
    await accountSchemaReady();
    const tokenHash = digestToken(parsed.data.token);
    const [target] =
      await sql`SELECT target_user_id FROM account_tokens WHERE token_hash=${tokenHash} AND kind='password_reset'`;
    if (!target) return invalidLink();
    const passwordHash = await hashPassword(parsed.data.password);
    const changed = await sql.begin(async (tx) => {
      const [user] =
        await tx`SELECT id,login_id,active FROM users WHERE id=${target.target_user_id} FOR UPDATE`;
      const [token] =
        await tx`SELECT t.* FROM account_tokens t JOIN users creator ON creator.id=t.created_by WHERE t.token_hash=${tokenHash} AND t.kind='password_reset' AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>now() AND creator.active AND creator.role='administrator' FOR UPDATE OF t`;
      if (!user?.active || !token) return false;
      await tx`UPDATE users SET password_hash=${passwordHash},password_change_required=false,password_changed_at=now(),session_version=session_version+1,updated_at=now() WHERE id=${user.id}`;
      await tx`UPDATE account_tokens SET used_at=now() WHERE id=${token.id}`;
      await tx`UPDATE account_tokens SET revoked_at=now() WHERE target_user_id=${user.id} AND used_at IS NULL AND revoked_at IS NULL`;
      await tx`DELETE FROM auth_login_attempts WHERE login_id=${user.login_id}`;
      await tx`INSERT INTO user_audit_events(actor_user_id,target_user_id,action,detail) VALUES(${user.id},${user.id},'password_reset_completed','{}')`;
      return true;
    });
    return changed
      ? Response.json(
          { changed: true },
          { headers: { "cache-control": "no-store" } },
        )
      : invalidLink();
  } catch {
    return accessError(
      "ACCOUNT_UNAVAILABLE",
      "The password change could not be confirmed. Try signing in with your new password, or request a new reset link.",
      503,
    );
  }
}
