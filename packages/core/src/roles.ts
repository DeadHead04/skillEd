import { db } from "./db";
/** Run only with migration credentials. Runtime passwords are inputs, never logged. */
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
const sql = db(url);
try {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(83746201)`;
    for (const [role, variable] of [
      ["skilled_web", "SKILLED_WEB_DB_PASSWORD"],
      ["skilled_controller", "SKILLED_CONTROLLER_DB_PASSWORD"],
    ] as const) {
      const password = process.env[variable!] ?? "";
      if (password.length < 32)
        throw new Error(`${variable} must contain at least 32 characters`);
      const [existing] = await tx`SELECT 1 FROM pg_roles WHERE rolname=${role}`;
      // Role names are fixed constants. Password literals are escaped by PostgreSQL itself.
      const [literal] = await tx`SELECT quote_literal(${password}) value`;
      if (!existing)
        await tx.unsafe(
          `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
        );
      await tx.unsafe(`ALTER ROLE ${role} PASSWORD ${literal!.value}`);
      await tx.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
      if (role === "skilled_web")
        await tx`GRANT SELECT ON ALL TABLES IN SCHEMA public TO skilled_web`;
      else
        await tx`GRANT SELECT ON lifecycle_transitions,schema_migrations,skills,skill_versions,eval_versions,eval_files,eval_cases,conversations,conversation_messages,jobs,job_events,runs,case_results,update_proposals,worker_heartbeats,decision_records,history_assessments TO skilled_controller`;
      await tx.unsafe(
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
      );
    }
    await tx`GRANT INSERT,UPDATE,DELETE ON skills,eval_versions,eval_files,eval_cases,conversations,conversation_messages,jobs,runs,update_proposals,users,auth_login_attempts,account_tokens TO skilled_web`;
    await tx`GRANT INSERT ON skill_versions,decision_records,user_audit_events,job_events,request_receipts TO skilled_web`;
    await tx`GRANT INSERT,UPDATE,DELETE ON eval_versions,eval_cases,conversations,conversation_messages,jobs,runs,case_results,update_proposals,worker_heartbeats TO skilled_controller`;
    await tx`GRANT INSERT ON job_events,decision_records TO skilled_controller`;
    await tx`REVOKE CREATE ON SCHEMA public FROM PUBLIC`;
  });
  console.log(
    "Restricted web and controller roles provisioned. No runtime role has DDL or migration privileges.",
  );
} finally {
  await sql.end();
}
