import type { Db } from "@skilled/core";

type WorkerJob = Record<string, any>;

/** Returns resources belonging to jobs that must retain their workspaces. */
export async function findActiveJobResourceIds(sql: Db) {
  const jobs = await sql`SELECT resource_id FROM jobs WHERE status='running'`;
  return jobs.map((job) => String(job.resource_id));
}

/** Extends a claimed job's lease and returns its cancellation state. */
export async function renewJobLease(sql: Db, workerId: string, job: WorkerJob) {
  return sql`UPDATE jobs SET lease_expires_at=now()+interval '60 seconds' WHERE id=${job.id} AND status='running' AND lease_owner=${workerId} AND lease_token=${job.lease_token} RETURNING id,cancel_requested_at`;
}

/** Retrieves the status of the run that owns a run job. */
export async function findRunStatus(sql: Db, resourceId: string) {
  const [run] = await sql`SELECT status FROM runs WHERE id=${resourceId}`;
  return run;
}

/** Marks a successfully handled job with its resolved terminal status. */
export async function completeJob(
  sql: Db,
  workerId: string,
  job: WorkerJob,
  status: string,
) {
  await sql`UPDATE jobs SET status=${status},completed_at=now(),lease_expires_at=null WHERE id=${job.id} AND status='running' AND lease_token=${job.lease_token} AND lease_owner=${workerId}`;
}

/** Returns a job only when this worker still owns its active lease. */
export async function findOwnedActiveJob(
  sql: Db,
  workerId: string,
  job: WorkerJob,
) {
  const [owned] =
    await sql`SELECT id,cancel_requested_at FROM jobs WHERE id=${job.id} AND lease_token=${job.lease_token} AND lease_owner=${workerId} AND status='running'`;
  return owned;
}

/** Marks a non-approved evaluation version as failed with diagnostic detail. */
export async function failEvaluationVersion(
  sql: Db,
  resourceId: string,
  detail: string,
) {
  await sql`UPDATE eval_versions SET status='failed',validation=${sql.json({ valid: false, error: detail })} WHERE id=${resourceId} AND status <> 'approved'`;
}

/** Marks an unfinished run as failed or cancelled after worker processing fails. */
export async function failRun(sql: Db, resourceId: string, cancelled: boolean) {
  await sql`UPDATE runs SET status=${cancelled ? "cancelled" : "failed"},completed_at=now() WHERE id=${resourceId} AND status NOT IN ('completed','failed','cancelled','interrupted')`;
}

/** Marks a non-approved proposal as failed after its generation cannot complete. */
export async function failProposal(sql: Db, resourceId: string) {
  await sql`UPDATE update_proposals SET status='failed',updated_at=now() WHERE id=${resourceId} AND status <> 'approved'`;
}

/** Records a job failure or cancellation and clears its processing lease. */
export async function failJob(
  sql: Db,
  job: WorkerJob,
  cancelled: boolean,
  detail: string,
) {
  await sql`UPDATE jobs SET status=${cancelled ? "cancelled" : "failed"},error=${sql.json({ code: cancelled ? "CANCELLED" : "WORKER_FAILURE", detail })},completed_at=now(),lease_expires_at=null WHERE id=${job.id}`;
}
