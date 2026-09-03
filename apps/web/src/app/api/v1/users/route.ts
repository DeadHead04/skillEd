import { CreateUserSchema, db, problem } from "@skilled/core";
import { authenticatedUser } from "../../../../lib/auth";

export const runtime = "nodejs";
const sql = db();

function forbidden() {
  return Response.json(
    problem(
      "ADMIN_REQUIRED",
      "Administrator access required",
      "Only an administrator can manage SkillEd users.",
    ),
    { status: 403 },
  );
}

export async function GET(request: Request) {
  const actor = authenticatedUser(request);
  if (actor?.role !== "administrator") return forbidden();
  const users =
    await sql`SELECT id,login_id,display_name,role,active,last_login_at,password_changed_at,created_at,updated_at
    FROM users ORDER BY active DESC,role,display_name,login_id`;
  return Response.json({ users });
}

export async function POST(request: Request) {
  const actor = authenticatedUser(request);
  if (actor?.role !== "administrator") return forbidden();
  const parsed = CreateUserSchema.safeParse(await request.json());
  if (!parsed.success)
    return Response.json(
      problem(
        "VALIDATION",
        "Invalid user",
        parsed.error.issues[0]?.message ?? "Check the user fields.",
      ),
      { status: 400 },
    );
  const { loginId, displayName, role, password } = parsed.data;
  try {
    const [user] = await sql.begin(async (tx) => {
      const rows =
        await tx`INSERT INTO users(login_id,display_name,role,password_hash)
        VALUES(${loginId},${displayName},${role},crypt(${password},gen_salt('bf',12)))
        RETURNING id,login_id,display_name,role,active,last_login_at,password_changed_at,created_at,updated_at`;
      await tx`INSERT INTO user_audit_events(actor_user_id,target_user_id,action,detail)
        VALUES(${actor.id},${rows[0]?.id},'user_created',${tx.json({ loginId, role })})`;
      return rows;
    });
    return Response.json({ user }, { status: 201 });
  } catch (cause) {
    if ((cause as { code?: string }).code === "23505")
      return Response.json(
        problem(
          "LOGIN_ID_EXISTS",
          "Login ID already exists",
          "Choose a different login ID.",
        ),
        { status: 409 },
      );
    return Response.json(
      problem(
        "USER_CREATE_FAILED",
        "User could not be created",
        "The account was not changed. Try again or inspect the web service log.",
        true,
      ),
      { status: 500 },
    );
  }
}
