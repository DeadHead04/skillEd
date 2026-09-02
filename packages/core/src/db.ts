import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export type Db = ReturnType<typeof postgres>;
export function db(
  url = process.env.DATABASE_URL ??
    "postgres://skilled:skilled@127.0.0.1:5432/skilled",
) {
  return postgres(url, { max: 10, transform: { undefined: null } });
}
export async function ensureSchema(sql: Db) {
  const source = await readFile(
    fileURLToPath(new URL("./schema.sql", import.meta.url)),
    "utf8",
  );
  await sql.unsafe(source);
  await sql`INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING`;
}
export async function emit(
  sql: Db,
  jobId: string,
  type: string,
  data: unknown = {},
) {
  const [event] =
    await sql`INSERT INTO job_events(job_id,type,data) VALUES(${jobId},${type},${sql.json(data as never)}) RETURNING sequence`;
  return Number(event?.sequence);
}
export async function enqueue(
  sql: Db,
  type: string,
  resourceId: string | null,
  payload: unknown = {},
) {
  const [job] =
    await sql`INSERT INTO jobs(type,resource_id,payload) VALUES(${type},${resourceId},${sql.json(payload as never)}) RETURNING id`;
  if (!job) throw new Error("Could not enqueue job");
  await emit(sql, job.id, "stage_changed", { stage: "queued" });
  return job.id as string;
}
export async function claimJob(sql: Db, workerId: string) {
  const rows = await sql.begin(async (tx) => {
    const [job] =
      await tx`SELECT * FROM jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (!job) return [];
    return tx`UPDATE jobs SET status='running',attempt=attempt+1,started_at=COALESCE(started_at,now()),lease_owner=${workerId},lease_expires_at=now()+interval '30 seconds' WHERE id=${job.id} RETURNING *`;
  });
  return rows[0] ?? null;
}
