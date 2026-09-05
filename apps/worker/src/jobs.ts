import { emit, type Db } from "@skilled/core";
export async function reconcileJobs(sql: Db) {
  await sql.begin(async (tx) => {
    const jobs =
      await tx`SELECT * FROM jobs WHERE (status='running' AND (lease_expires_at IS NULL OR lease_expires_at < now())) OR (status='queued' AND cancel_requested_at IS NOT NULL) FOR UPDATE SKIP LOCKED`;
    for (const job of jobs) {
      const cancelled = Boolean(job.cancel_requested_at);
      const detail = cancelled
        ? "Operation cancelled"
        : "Execution lease expired; retry explicitly";
      if (String(job.type).startsWith("eval_"))
        await tx`UPDATE eval_versions SET status='failed',validation=${tx.json({ valid: false, error: detail })} WHERE id=${job.resource_id} AND status <> 'approved'`;
      if (job.type === "run")
        await tx`UPDATE runs SET status=${cancelled ? "cancelled" : "interrupted"},completed_at=now() WHERE id=${job.resource_id} AND status NOT IN ('completed','failed','cancelled','interrupted')`;
      if (job.type === "proposal")
        await tx`UPDATE update_proposals SET status='failed',updated_at=now() WHERE id=${job.resource_id} AND status='generating'`;
      await tx`UPDATE update_proposals SET status='failed',comparison=${tx.json({ blocked: true, reasons: [detail] })},updated_at=now() WHERE status='verifying' AND (current_verification_run_id=${job.resource_id} OR candidate_verification_run_id=${job.resource_id})`;
      await tx`UPDATE jobs SET status=${cancelled ? "cancelled" : "interrupted"},lease_token=lease_token+1,lease_expires_at=null,completed_at=now(),error=${tx.json({ code: cancelled ? "CANCELLED" : "LEASE_EXPIRED", detail })} WHERE id=${job.id}`;
      await emit(
        tx as unknown as Db,
        job.id,
        cancelled ? "cancelled" : "interrupted",
        {
          code: cancelled ? "CANCELLED" : "LEASE_EXPIRED",
          detail,
        },
      );
    }
  });
}
/** Every statement and transaction is fenced against a replaced execution owner. */
export function fencedDatabase(sql: Db, job: Record<string, any>): Db {
  const guard = async (tx: Db) => {
    const [current] =
      await tx`SELECT status,lease_token,lease_owner,lease_expires_at FROM jobs WHERE id=${job.id} FOR SHARE`;
    if (
      !current ||
      current.status !== "running" ||
      Number(current.lease_token) !== Number(job.lease_token) ||
      current.lease_owner !== job.lease_owner ||
      new Date(current.lease_expires_at).getTime() <= Date.now()
    )
      throw new Error("Execution lease lost");
  };
  return new Proxy(sql, {
    apply(_target, _this, args) {
      return sql.begin(async (tx) => {
        await guard(tx as unknown as Db);
        return Reflect.apply(tx, tx, args);
      });
    },
    get(target, key) {
      if (key === "begin")
        return (fn: (tx: Db) => Promise<unknown>) =>
          sql.begin(async (tx) => {
            await guard(tx as unknown as Db);
            return fn(tx as unknown as Db);
          });
      return Reflect.get(target, key);
    },
  });
}
