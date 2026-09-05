import { transitions } from "./states";
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export type Db = ReturnType<typeof postgres>;
const connections = new Set<Db>();
export async function closeDatabases() {
  await Promise.all([...connections].map((sql) => sql.end({ timeout: 2 })));
  connections.clear();
}
export function db(
  url = process.env.DATABASE_URL ??
    "postgres://skilled:skilled@127.0.0.1:5432/skilled",
  connection: Record<string, string> = {},
) {
  const sql = postgres(url, {
    max: 10,
    transform: { undefined: null },
    connection,
  });
  const originalEnd = sql.end.bind(sql);
  sql.end = async (options) => {
    connections.delete(sql);
    await originalEnd(options);
  };
  connections.add(sql);
  return sql;
}
export async function ensureSchema(sql: Db) {
  if (process.env.SKILLED_AUTO_MIGRATE === "false") {
    const [row] = await sql`SELECT max(version) version FROM schema_migrations`;
    if (Number(row?.version) < 5)
      throw new Error("Database migration required");
    return;
  }
  await migrate(sql);
}
export async function migrate(sql: Db) {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(83746201)`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const applied = await tx`SELECT version FROM schema_migrations`;
    const versions = new Set(applied.map((r) => Number(r.version)));
    if (!versions.has(2)) {
      await tx.unsafe(
        await readFile(
          fileURLToPath(new URL("./schema.sql", import.meta.url)),
          "utf8",
        ),
      );
      await tx`INSERT INTO schema_migrations(version) VALUES(1),(2) ON CONFLICT DO NOTHING`;
    }
    if (!versions.has(3)) {
      await tx.unsafe(
        await readFile(
          fileURLToPath(
            new URL("./migrations/003_integrity.sql", import.meta.url),
          ),
          "utf8",
        ),
      );
      await tx`INSERT INTO schema_migrations(version) VALUES(3)`;
    }
    if (!versions.has(4)) {
      await tx.unsafe(
        await readFile(
          fileURLToPath(
            new URL("./migrations/004_lifecycle.sql", import.meta.url),
          ),
          "utf8",
        ),
      );
      for (const [machine, states] of Object.entries(transitions))
        for (const [from, targets] of Object.entries(states))
          for (const to of targets)
            await tx`INSERT INTO lifecycle_transitions(machine,from_state,to_state) VALUES(${machine},${from},${to})`;
      await tx`INSERT INTO schema_migrations(version) VALUES(4)`;
    }
    if (!versions.has(5)) {
      await tx.unsafe(
        await readFile(
          fileURLToPath(
            new URL("./migrations/005_package_identity.sql", import.meta.url),
          ),
          "utf8",
        ),
      );
      await tx`INSERT INTO schema_migrations(version) VALUES(5)`;
    }
  });
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
    await sql`INSERT INTO jobs(type,resource_id,payload,adapter) VALUES(${type},${resourceId},${sql.json(payload as never)},${process.env.SKILLED_ADAPTER_MODE === "fake" ? "demo" : "real"}) RETURNING id`;
  if (!job) throw new Error("Could not enqueue job");
  await emit(sql, job.id, "stage_changed", { stage: "queued" });
  return job.id as string;
}
export async function claimJob(sql: Db, workerId: string) {
  const rows = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(83746202)`;
    const active =
      await tx`SELECT id FROM jobs WHERE status='running' AND lease_expires_at > now() LIMIT 1`;
    if (active.length) return [];
    const [job] =
      await tx`SELECT * FROM jobs WHERE status='queued' AND cancel_requested_at IS NULL ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (!job) return [];
    return tx`UPDATE jobs SET status='running',attempt=attempt+1,lease_token=lease_token+1,started_at=COALESCE(started_at,now()),lease_owner=${workerId},lease_expires_at=now()+interval '60 seconds' WHERE id=${job.id} RETURNING *`;
  });
  return rows[0] ?? null;
}
