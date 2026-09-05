import { db } from "./db";
const url = process.env.MIGRATION_DATABASE_URL,
  login = process.env.SKILLED_ADMIN_LOGIN_ID,
  password = process.env.SKILLED_ADMIN_PASSWORD;
if (!url || !login || !password || password.length < 12)
  throw new Error(
    "Migration URL, exact administrator login ID and a new password of at least 12 characters are required",
  );
const sql = db(url);
try {
  await sql.begin(async (tx) => {
    const rows =
      await tx`UPDATE users SET password_hash=crypt(${password},gen_salt('bf',12)),session_version=session_version+1,active=true,password_changed_at=now(),updated_at=now() WHERE login_id=${login} AND role='administrator' RETURNING id`;
    if (rows.length !== 1)
      throw new Error("Exactly one existing administrator must match");
    await tx`INSERT INTO user_audit_events(target_user_id,action,detail) VALUES(${rows[0]!.id},'migration_admin_recovery','{"method":"migration-credentials"}')`;
  });
  console.log(
    "Administrator access recovered; previous application sessions are invalid.",
  );
} finally {
  await sql.end();
}
