import {
  requireStorage,
  cleanWorkspaces,
  serviceEndpoint,
} from "@skilled/core";
import { claimJob, db, emit, ensureSchema } from "@skilled/core";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { authorEval, generateEval } from "./evals.js";
import { generateProposal } from "./proposals.js";
import { runEvaluation, finalizeVerification } from "./runner.js";

import { executionContext } from "./remote-execution.js";
import { randomUUID } from "node:crypto";
import { fencedDatabase, reconcileJobs } from "./jobs.js";
import { stopExecutions } from "./process.js";
import { codexAppServer } from "./app-server.js";
import { requireExecutionReady, executionReadiness } from "./readiness.js";
const sql = db();
const workerId = `worker-${randomUUID()}`;
const run = promisify(execFile);
async function version(command: string, args: string[]) {
  try {
    const value = await run(command, args, { timeout: 10_000 });
    return (
      (value.stdout.trim() || value.stderr.trim()).split("\n")[0] ??
      "unavailable"
    );
  } catch {
    return "unavailable";
  }
}
async function heartbeat() {
  if (
    serviceEndpoint("EXECUTOR") &&
    process.env.SKILLED_ADAPTER_MODE !== "fake"
  ) {
    let readiness: Record<string, unknown> = {
      execution: "blocked",
      appServer: false,
      detail: "Executor unreachable",
      code: "EXECUTOR_UNREACHABLE",
      codexLogin: "not_checked",
    };
    try {
      const response = await fetch(`${serviceEndpoint("EXECUTOR")}/readiness`, {
        headers: {
          authorization: `Bearer ${process.env.EXECUTOR_SERVICE_TOKEN ?? ""}`,
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("Executor readiness unavailable");
      const health = await response.json();
      if (
        typeof health.ready !== "boolean" ||
        typeof health.code !== "string" ||
        typeof health.detail !== "string"
      )
        throw new Error("Invalid executor readiness response");
      readiness = {
        ...health,
        execution: health.ready ? "ready" : "blocked",
        appServer: health.ready,
        skillUp: health.ready,
      };
    } catch {
      /* Queue and historical results remain available. */
    }
    await sql`INSERT INTO worker_heartbeats(worker_id,versions,readiness,last_seen_at) VALUES(${workerId},${sql.json({ node: process.version, executor: "private-service" })},${sql.json(readiness as never)},now()) ON CONFLICT(worker_id) DO UPDATE SET versions=excluded.versions,readiness=excluded.readiness,last_seen_at=now()`;
    return;
  }
  const versions = {
    codex: await version(process.env.CODEX_BIN ?? "codex", ["--version"]),
    skillUp: await version(process.env.SKILL_UP_BIN ?? "skill-up", [
      "--version",
    ]),
    skillUpSource: "vendored",
    node: process.version,
  };
  const acceptance =
    process.env.SKILLED_ADAPTER_MODE === "fake"
      ? {
          ready: true,
          code: "DEMO",
          codexLogin: "fake-ready",
          detail: "Demo evidence: deterministic execution without model calls.",
        }
      : await executionReadiness();
  await sql`INSERT INTO worker_heartbeats(worker_id,versions,readiness,last_seen_at) VALUES(${workerId},${sql.json(versions)},${sql.json({ ...acceptance, appServer: acceptance.ready, execution: process.env.SKILLED_ADAPTER_MODE === "fake" ? "demo" : acceptance.ready ? "ready" : "blocked", skillUp: versions.skillUp !== "unavailable" })},now()) ON CONFLICT(worker_id) DO UPDATE SET versions=excluded.versions,readiness=excluded.readiness,last_seen_at=now()`;
}
let busy = false;
let stopping = false;
async function tick() {
  if (busy || stopping) return;
  busy = true;
  let leaseTimer: NodeJS.Timeout | undefined;
  let job: Record<string, any> | null = null;
  try {
    await heartbeat();
    const active =
      await sql`SELECT resource_id FROM jobs WHERE status='running'`;
    await cleanWorkspaces(
      process.env.WORK_ROOT ?? "/data/work",
      active.map((j) => String(j.resource_id)),
    );
    job = (await claimJob(sql, workerId)) as Record<string, any> | null;
    if (!job) return;
    await requireStorage(process.env.WORK_ROOT ?? "/data/work");
    const abort = new AbortController();
    job.signal = abort.signal;
    const activeJob = job;
    leaseTimer = setInterval(() => {
      void sql`UPDATE jobs SET lease_expires_at=now()+interval '60 seconds' WHERE id=${activeJob.id} AND status='running' AND lease_owner=${workerId} AND lease_token=${activeJob.lease_token} RETURNING id,cancel_requested_at`
        .then((rows) => {
          if (!rows.length || rows[0]?.cancel_requested_at) {
            abort.abort();
            stopExecutions();
            void codexAppServer.stop();
          }
          return sql`UPDATE worker_heartbeats SET last_seen_at=now() WHERE worker_id=${workerId}`;
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
    const [owner] =
      job.type === "run"
        ? await sql`SELECT status FROM runs WHERE id=${job.resource_id}`
        : [];
    const status =
      owner?.status === "cancelled"
        ? "cancelled"
        : owner?.status === "failed"
          ? "failed"
          : "completed";
    await sql`UPDATE jobs SET status=${status},completed_at=now(),lease_expires_at=null WHERE id=${job.id} AND status='running' AND lease_token=${job.lease_token} AND lease_owner=${workerId}`;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (!job) {
      console.error("Worker tick failed before a job was claimed", cause);
      return;
    }
    const [owned] =
      await sql`SELECT id,cancel_requested_at FROM jobs WHERE id=${job.id} AND lease_token=${job.lease_token} AND lease_owner=${workerId} AND status='running'`;
    if (!owned) return;
    const cancelled = Boolean(owned.cancel_requested_at);
    if (job.type.startsWith("eval_"))
      await sql`UPDATE eval_versions SET status='failed',validation=${sql.json({ valid: false, error: detail })} WHERE id=${job.resource_id} AND status <> 'approved'`;
    if (job.type === "run")
      await sql`UPDATE runs SET status=${cancelled ? "cancelled" : "failed"},completed_at=now() WHERE id=${job.resource_id} AND status NOT IN ('completed','failed','cancelled','interrupted')`;
    if (job.type === "proposal")
      await sql`UPDATE update_proposals SET status='failed',updated_at=now() WHERE id=${job.resource_id} AND status <> 'approved'`;
    await sql`UPDATE jobs SET status=${cancelled ? "cancelled" : "failed"},error=${sql.json({ code: cancelled ? "CANCELLED" : "WORKER_FAILURE", detail })},completed_at=now(),lease_expires_at=null WHERE id=${job.id}`;
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
await ensureSchema(sql);
await reconcileJobs(sql);
const reconcileTimer = setInterval(
  () =>
    void reconcileJobs(sql).catch((error) =>
      console.error("Job reconciliation failed", error),
    ),
  10_000,
);
const tickTimer = setInterval(() => void tick(), 1000);
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(tickTimer);
  clearInterval(reconcileTimer);
  stopExecutions();
  await codexAppServer.stop();
  const deadline = Date.now() + 90_000;
  while (busy && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 200));
  stopExecutions("SIGKILL");
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
await tick();
