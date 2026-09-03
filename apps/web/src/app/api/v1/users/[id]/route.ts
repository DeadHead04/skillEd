import { UpdateUserSchema, db, problem } from "@skilled/core";
import { authenticatedUser } from "../../../../../lib/auth";

export const runtime = "nodejs";
const sql = db();
type Context = { params: Promise<{ id: string }> };

function responseProblem(
  code: string,
  title: string,
  detail: string,
  status: number,
) {
  return Response.json(problem(code, title, detail), { status });
}

export async function PATCH(request: Request, context: Context) {
  const actor = authenticatedUser(request);
  if (actor?.role !== "administrator")
    return responseProblem(
      "ADMIN_REQUIRED",
      "Administrator access required",
      "Only an administrator can manage SkillEd users.",
      403,
    );
  const parsed = UpdateUserSchema.safeParse(await request.json());
  if (!parsed.success)
    return responseProblem(
      "VALIDATION",
      "Invalid user update",
      parsed.error.issues[0]?.message ?? "Check the user fields.",
      400,
    );
  const { id } = await context.params;
  const input = parsed.data;
  try {
    const user = await sql.begin(async (tx) => {
      const [current] = await tx`SELECT * FROM users WHERE id=${id} FOR UPDATE`;
      if (!current) return null;
      const role = input.role ?? current.role;
      const active = input.active ?? current.active;
      if (actor.id === id && (active === false || role !== "administrator"))
        throw Object.assign(
          new Error(
            "Use another administrator account to deactivate or demote your own account.",
          ),
          { status: 409, code: "SELF_LOCKOUT" },
        );
      if (
        current.active &&
        current.role === "administrator" &&
        (!active || role !== "administrator")
      ) {
        await tx`SELECT id FROM users WHERE active=true AND role='administrator' FOR UPDATE`;
        const [admins] =
          await tx`SELECT count(*)::integer AS count FROM users WHERE active=true AND role='administrator'`;
        if (Number(admins?.count) <= 1)
          throw Object.assign(
            new Error("At least one active administrator must remain."),
            { status: 409, code: "LAST_ADMIN" },
          );
      }
      const displayName = input.displayName ?? current.display_name;
      const revokeSessions =
        input.password !== undefined ||
        role !== current.role ||
        active !== current.active;
      const [updated] = input.password
        ? await tx`UPDATE users SET display_name=${displayName},role=${role},active=${active},password_hash=crypt(${input.password},gen_salt('bf',12)),password_changed_at=now(),session_version=session_version+1,updated_at=now() WHERE id=${id}
            RETURNING id,login_id,display_name,role,active,last_login_at,password_changed_at,created_at,updated_at`
        : await tx`UPDATE users SET display_name=${displayName},role=${role},active=${active},session_version=session_version+${revokeSessions ? 1 : 0},updated_at=now() WHERE id=${id}
            RETURNING id,login_id,display_name,role,active,last_login_at,password_changed_at,created_at,updated_at`;
      if (input.password)
        await tx`DELETE FROM auth_login_attempts WHERE login_id=${current.login_id}`;
      await tx`INSERT INTO user_audit_events(actor_user_id,target_user_id,action,detail)
        VALUES(${actor.id},${id},'user_updated',${tx.json({ displayNameChanged: displayName !== current.display_name, role: role !== current.role ? role : undefined, active: active !== current.active ? active : undefined, passwordReset: input.password !== undefined, sessionsRevoked: revokeSessions })})`;
      return updated;
    });
    if (!user)
      return responseProblem(
        "NOT_FOUND",
        "User not found",
        "The requested user does not exist.",
        404,
      );
    return Response.json({ user });
  } catch (cause) {
    const known = cause as { status?: number; code?: string; message?: string };
    if (known.status)
      return responseProblem(
        known.code ?? "USER_UPDATE_BLOCKED",
        "User update blocked",
        known.message ?? "The user could not be updated.",
        known.status,
      );
    return Response.json(
      problem(
        "USER_UPDATE_FAILED",
        "User could not be updated",
        "The account was not changed. Try again or inspect the web service log.",
        true,
      ),
      { status: 500 },
    );
  }
}
