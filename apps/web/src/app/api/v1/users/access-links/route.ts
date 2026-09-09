import { z } from "zod";
import { authenticatedUser } from "../../../../../lib/auth";
import {
  accountDb as sql,
  IssueSchema,
  newAccountToken,
  accessError,
} from "../../../../../lib/account-access";
export async function GET(request: Request) {
  if (authenticatedUser(request)?.role !== "administrator")
    return accessError(
      "ADMIN_REQUIRED",
      "Only administrators can manage account links.",
      403,
    );
  const links =
    await sql`SELECT t.id,t.kind,t.label,t.role,t.target_user_id,u.login_id,t.created_at,t.expires_at,t.used_at,t.revoked_at FROM account_tokens t LEFT JOIN users u ON u.id=t.target_user_id ORDER BY t.created_at DESC LIMIT 100`;
  return Response.json({ links }, { headers: { "cache-control": "no-store" } });
}
export async function POST(request: Request) {
  const actor = authenticatedUser(request);
  if (actor?.role !== "administrator")
    return accessError(
      "ADMIN_REQUIRED",
      "Only administrators can issue account links.",
      403,
    );
  const parsed = IssueSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return accessError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Check the link details.",
    );
  const input = parsed.data;
  const { token, hash } = newAccountToken();
  const expiresAt = new Date(
    Date.now() + (input.kind === "invitation" ? 7 * 24 : 1) * 60 * 60_000,
  );
  const result = await sql.begin(async (tx) => {
    if (input.kind === "password_reset") {
      const [target] =
        await tx`SELECT id FROM users WHERE id=${input.userId} AND active FOR UPDATE`;
      if (!target) return null;
      await tx`UPDATE account_tokens SET revoked_at=now() WHERE target_user_id=${input.userId} AND used_at IS NULL AND revoked_at IS NULL`;
    }
    const [link] =
      await tx`INSERT INTO account_tokens(token_hash,kind,label,role,target_user_id,created_by,expires_at) VALUES(${hash},${input.kind},${input.kind === "invitation" ? input.label : "Password reset"},${input.kind === "invitation" ? input.role : "operator"},${input.kind === "password_reset" ? input.userId : null},${actor.id},${expiresAt}) RETURNING id`;
    await tx`INSERT INTO user_audit_events(actor_user_id,target_user_id,action,detail) VALUES(${actor.id},${input.kind === "password_reset" ? input.userId : null},'account_link_created',${tx.json({ id: link!.id, kind: input.kind })})`;
    return link;
  });
  if (!result)
    return accessError(
      "NOT_FOUND",
      "An active account is required for password recovery.",
      404,
    );
  // Fragments stay out of HTTP request URLs and referrer headers. Return only a relative path.
  return Response.json(
    {
      id: result.id,
      path: `/${input.kind === "invitation" ? "signup" : "reset-password"}#token=${token}`,
      expiresAt,
    },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}
export async function DELETE(request: Request) {
  const actor = authenticatedUser(request);
  if (actor?.role !== "administrator")
    return accessError(
      "ADMIN_REQUIRED",
      "Only administrators can revoke account links.",
      403,
    );
  const input = z
    .object({ id: z.uuid() })
    .safeParse(await request.json().catch(() => null));
  if (!input.success)
    return accessError("VALIDATION", "Select a valid account link.");
  await sql.begin(async (tx) => {
    const rows =
      await tx`UPDATE account_tokens SET revoked_at=now() WHERE id=${input.data.id} AND used_at IS NULL AND revoked_at IS NULL RETURNING id`;
    if (rows.length)
      await tx`INSERT INTO user_audit_events(actor_user_id,action,detail) VALUES(${actor.id},'account_link_revoked',${tx.json({ id: input.data.id })})`;
  });
  return Response.json({ revoked: true });
}
