import {
  claimJob,
  cleanWorkspaces,
  emit,
  requireStorage,
  serviceEndpoint,
  type Db,
} from "@skilled/core";
import { codexAppServer } from "../app-server.js";
import { authorEval, generateEval } from "../evals.js";
import { heartbeat } from "../heartbeat/index.js";
import { touchHeartbeat } from "../heartbeat/queries.js";
import { fencedDatabase } from "../jobs.js";
import { stopExecutions } from "../process.js";
import { generateProposal } from "../proposals.js";
import { requireExecutionReady } from "../readiness.js";
import { executionContext } from "../remote-execution.js";
import { finalizeVerification, runEvaluation } from "../runner.js";
import {
  completeJob,
  failEvaluationVersion,
  failJob,
  failProposal,
  failRun,
  findActiveJobResourceIds,
  findOwnedActiveJob,
  findRunStatus,
  renewJobLease,
} from "./queries.js";

let busy = false;
let stopping = false;

/** Prevents new ticks from starting while the worker shuts down. */
export function stopTicking() {
  stopping = true;
}

/** Reports whether a tick is currently processing a claimed job. */
export function isTickBusy() {
  return busy;
}

/** Performs one heartbeat, cleanup, claim, execution, and job-finalization cycle. */
export async function tick(sql: Db, workerId: string) {
  if (busy || stopping) return;
  busy = true;
  let leaseTimer: NodeJS.Timeout | undefined;
  let job: Record<string, any> | null = null;
  try {
    await heartbeat(sql, workerId);
    await cleanWorkspaces(
      process.env.WORK_ROOT ?? "/data/work",
      await findActiveJobResourceIds(sql),
    );
    job = (await claimJob(sql, workerId)) as Record<string, any> | null;
    if (!job) return;
    await requireStorage(process.env.WORK_ROOT ?? "/data/work");
    const abort = new AbortController();
    job.signal = abort.signal;
    const activeJob = job;
    leaseTimer = setInterval(() => {
      void renewJobLease(sql, workerId, activeJob)
        .then((rows) => {
          if (!rows.length || rows[0]?.cancel_requested_at) {
            abort.abort();
            stopExecutions();
            void codexAppServer.stop();
          }
          return touchHeartbeat(sql, workerId);
        })
        .catch((cause) => {
          abort.abort();
          stopExecutions();
          void codexAppServer.stop();
          console.error("Failed to renew worker lease", cause);
        });
    }, 10_000);
    if (
      job.adapter !==
      (process.env.SKILLED_ADAPTER_MODE === "fake" ? "demo" : "real")
    )
      throw new Error("Job adapter differs from worker mode");
    if (job.adapter === "real" && !serviceEndpoint("EXECUTOR"))
      await requireExecutionReady();
    const fenced = fencedDatabase(sql, job);
    await executionContext.run(job, async () => {
      if (activeJob.type === "eval_author") await authorEval(fenced, activeJob);
      else if (activeJob.type === "eval_generate")
        await generateEval(fenced, activeJob);
      else if (activeJob.type === "run") await runEvaluation(fenced, activeJob);
      else if (activeJob.type === "proposal")
        await generateProposal(fenced, activeJob);
      else throw new Error(`Unsupported job: ${activeJob.type}`);
    });
    const owner =
      job.type === "run" ? await findRunStatus(sql, job.resource_id) : null;
    const status =
      owner?.status === "cancelled"
        ? "cancelled"
        : owner?.status === "failed"
          ? "failed"
          : "completed";
    await completeJob(sql, workerId, job, status);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (!job) {
      console.error("Worker tick failed before a job was claimed", cause);
      return;
    }
    const owned = await findOwnedActiveJob(sql, workerId, job);
    if (!owned) return;
    const cancelled = Boolean(owned.cancel_requested_at);
    if (job.type.startsWith("eval_"))
      await failEvaluationVersion(sql, job.resource_id, detail);
    if (job.type === "run") await failRun(sql, job.resource_id, cancelled);
    if (job.type === "proposal") await failProposal(sql, job.resource_id);
    await failJob(sql, job, cancelled, detail);
    await emit(sql, job.id, "failed", {
      code: cancelled ? "CANCELLED" : "WORKER_FAILURE",
      detail,
    });
    if (job.type === "run") await finalizeVerification(sql, job.resource_id);
  } finally {
    if (leaseTimer) clearInterval(leaseTimer);
    busy = false;
  }
}
