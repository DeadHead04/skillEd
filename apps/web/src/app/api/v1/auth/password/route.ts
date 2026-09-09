import { PasswordSchema } from "@skilled/core";
import { z } from "zod";
import { authenticatedUser } from "../../../../../lib/auth";
import {
  accountDb as sql,
  hashPassword,
  matchesPassword,
  accessError,
} from "../../../../../lib/account-access";
const Schema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    password: PasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match.",
  })
  .refine((v) => v.password !== v.currentPassword, {
    message: "Choose a different password from your current password.",
  });
export async function POST(request: Request) {
  const actor = authenticatedUser(request);
  if (!actor)
    return accessError(
      "AUTH_REQUIRED",
      "Sign in before changing your password.",
      401,
    );
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return accessError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Check your password.",
    );
  const [current] =
    await sql`SELECT password_hash,session_version FROM users WHERE id=${actor.id} AND active`;
  if (
    !current ||
    !(await matchesPassword(parsed.data.currentPassword, current.password_hash))
  )
    return accessError(
      "PASSWORD_INCORRECT",
      "Your current password is incorrect.",
      403,
    );
  const passwordHash = await hashPassword(parsed.data.password);
  const changed = await sql.begin(async (tx) => {
    const rows =
      await tx`UPDATE users SET password_hash=${passwordHash},password_change_required=false,password_changed_at=now(),session_version=session_version+1,updated_at=now() WHERE id=${actor.id} AND active AND password_hash=${current.password_hash} AND session_version=${current.session_version} RETURNING login_id`;
    if (!rows.length) return false;
    await tx`UPDATE account_tokens SET revoked_at=now() WHERE target_user_id=${actor.id} AND used_at IS NULL AND revoked_at IS NULL`;
    await tx`DELETE FROM auth_login_attempts WHERE login_id=${rows[0]!.login_id}`;
    await tx`INSERT INTO user_audit_events(actor_user_id,target_user_id,action,detail) VALUES(${actor.id},${actor.id},'password_changed','{}')`;
    return true;
  });
  return changed
    ? Response.json({ changed: true, signedOut: true })
    : accessError(
        "ACCOUNT_CHANGED",
        "Your account changed. Sign in again before retrying.",
        409,
      );
}
