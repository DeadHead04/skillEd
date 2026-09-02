import { claimJob, db, emit, ensureSchema } from "@skilled/core";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { authorEval, generateEval } from "./evals.js";
import { generateProposal } from "./proposals.js";
import { runEvaluation } from "./runner.js";

const sql = db();
const workerId = `worker-${process.pid}`;
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
  const versions = {
    codex: await version(process.env.CODEX_BIN ?? "codex", ["--version"]),
    skillUp: await version(process.env.SKILL_UP_BIN ?? "skill-up", ["--help"]),
    skillUpSource: "vendored",
    node: process.version,
  };
  const login =
    process.env.SKILLED_ADAPTER_MODE === "fake"
      ? "fake-ready"
      : await version(process.env.CODEX_BIN ?? "codex", ["login", "status"]);
  const loggedIn =
    process.env.SKILLED_ADAPTER_MODE === "fake" || /logged in/i.test(login);
  await sql`INSERT INTO worker_heartbeats(worker_id,versions,readiness,last_seen_at) VALUES(${workerId},${sql.json(versions)},${sql.json({ codexLogin: login, appServer: loggedIn, skillUp: versions.skillUp !== "unavailable" })},now()) ON CONFLICT(worker_id) DO UPDATE SET versions=excluded.versions,readiness=excluded.readiness,last_seen_at=now()`;
}
let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  let leaseTimer: NodeJS.Timeout | undefined;
  let job: Record<string, any> | null = null;
  try {
    await heartbeat();
    job = (await claimJob(sql, workerId)) as Record<string, any> | null;
    if (!job) return;
    const activeJob = job;
    leaseTimer = setInterval(() => {
      void sql`UPDATE jobs SET lease_expires_at=now()+interval '30 seconds' WHERE id=${activeJob.id} AND status='running' AND lease_owner=${workerId}`
        .then(
          () =>
            sql`UPDATE worker_heartbeats SET last_seen_at=now() WHERE worker_id=${workerId}`,
        )
        .catch((cause) => console.error("Failed to renew worker lease", cause));
    }, 10_000);
    if (job.type === "eval_author") await authorEval(sql, job);
    else if (job.type === "eval_generate") await generateEval(sql, job);
    else if (job.type === "run") await runEvaluation(sql, job);
    else if (job.type === "proposal") await generateProposal(sql, job);
    else throw new Error(`Unsupported job: ${job.type}`);
    await sql`UPDATE jobs SET status='completed',completed_at=now(),lease_expires_at=null WHERE id=${job.id} AND status='running'`;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (!job) {
      console.error("Worker tick failed before a job was claimed", cause);
      return;
    }
    if (job.type.startsWith("eval_"))
      await sql`UPDATE eval_versions SET status='failed',validation=${sql.json({ valid: false, error: detail })} WHERE id=${job.resource_id}`;
    if (job.type === "run")
      await sql`UPDATE runs SET status='failed',completed_at=now() WHERE id=${job.resource_id}`;
    if (job.type === "proposal")
      await sql`UPDATE update_proposals SET status='failed',updated_at=now() WHERE id=${job.resource_id}`;
    await sql`UPDATE jobs SET status='failed',error=${sql.json({ code: "WORKER_FAILURE", detail })},completed_at=now() WHERE id=${job.id}`;
    await emit(sql, job.id, "failed", { code: "WORKER_FAILURE", detail });
  } finally {
    if (leaseTimer) clearInterval(leaseTimer);
    busy = false;
  }
}
await ensureSchema(sql);
const abandoned =
  await sql`SELECT id,type,resource_id FROM jobs WHERE status='running' AND lease_expires_at < now()`;
for (const job of abandoned) {
  await sql.begin(async (tx) => {
    if (String(job.type).startsWith("eval_"))
      await tx`UPDATE eval_versions SET status='failed',validation=${tx.json({ valid: false, error: "Worker restarted during this operation" })} WHERE id=${job.resource_id}`;
    if (job.type === "run")
      await tx`UPDATE runs SET status='failed',completed_at=now() WHERE id=${job.resource_id}`;
    if (job.type === "proposal")
      await tx`UPDATE update_proposals SET status='failed',updated_at=now() WHERE id=${job.resource_id}`;
    await tx`UPDATE jobs SET status='interrupted',completed_at=now(),lease_expires_at=null,error=${tx.json({ code: "WORKER_RESTART", detail: "Worker lease was abandoned" })} WHERE id=${job.id}`;
  });
  await emit(sql, String(job.id), "failed", {
    code: "WORKER_RESTART",
    detail: "Worker lease was abandoned",
  });
}
setInterval(() => void tick(), 1000);
await tick();
