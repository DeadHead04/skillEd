import type { Db } from "@skilled/core";

/** Records the worker's current runtime versions and execution readiness. */
export async function recordHeartbeat(
  sql: Db,
  workerId: string,
  versions: Record<string, unknown>,
  readiness: Record<string, unknown>,
) {
  await sql`INSERT INTO worker_heartbeats(worker_id,versions,readiness,last_seen_at) VALUES(${workerId},${sql.json(versions as never)},${sql.json(readiness as never)},now()) ON CONFLICT(worker_id) DO UPDATE SET versions=excluded.versions,readiness=excluded.readiness,last_seen_at=now()`;
}

/** Updates the worker heartbeat timestamp while a job lease is active. */
export async function touchHeartbeat(sql: Db, workerId: string) {
  await sql`UPDATE worker_heartbeats SET last_seen_at=now() WHERE worker_id=${workerId}`;
}
