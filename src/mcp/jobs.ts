import { mkdir, readFile, writeFile, rename, realpath, readdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runMcpCli } from "./process.js";

export interface JobSpec {
  workspace: string;
  argv: string[];
  outputDir: string;
  timeoutSeconds: number;
}
export interface JobState {
  runId: string;
  status: "starting" | "running" | "completed" | "failed" | "cancelled" | "timed_out" | "interrupted" | "unresponsive";
  createdAt: string;
  updatedAt: string;
  ownerPid: number;
  outputDir: string;
  bootTimeMs?: number;
  exitCode?: number;
  error?: string;
  stdout?: string;
  stderr?: string;
  truncated?: boolean;
  reports?: string[];
  reportsTruncated?: boolean;
}
const terminal = new Set(["completed", "failed", "cancelled", "timed_out", "interrupted"]);
const worker = fileURLToPath(new URL("./job-worker.js", import.meta.url));
export function jobId(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
async function safeDirectory(root: string, id: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid runId");
  const resolved = await realpath(path.join(root, id));
  if (path.dirname(resolved) !== await realpath(root)) throw new Error("Job directory escapes workspace");
  return resolved;
}
async function readJson<T>(file: string): Promise<T> {
  const resolved = await realpath(file);
  if (path.dirname(resolved) !== await realpath(path.dirname(file))) throw new Error("Job file escapes its directory");
  if ((await stat(resolved)).size > 512 * 1024) throw new Error("Job metadata exceeds size limit");
  return JSON.parse(await readFile(resolved, "utf8")) as T;
}
async function atomicJson(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await rename(temporary, file);
}
function alive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
export async function readJob(root: string, runId: string): Promise<JobState> {
  const dir = await safeDirectory(root, runId);
  const state = await readJson<JobState>(path.join(dir, "state.json"));
  // Never signal a PID from persisted metadata: process IDs may have been reused.
  const differentBoot = state.bootTimeMs !== undefined &&
    Math.abs((Date.now() - os.uptime() * 1000) - state.bootTimeMs) > 60_000;
  if (!terminal.has(state.status) && (!alive(state.ownerPid) || differentBoot)) {
    state.status = "interrupted";
    state.error = "Evaluation worker exited before recording a terminal result. Inspect partial reports; use a new idempotency key to retry.";
    state.updatedAt = new Date().toISOString();
    // Derived state: a reader must never overwrite a concurrently completed worker.
  } else if (state.status === "running") {
    const heartbeat = await stat(path.join(dir, "heartbeat")).catch(() => undefined);
    if (Date.now() - (heartbeat?.mtimeMs ?? Date.parse(state.updatedAt)) > 30_000) {
      state.status = "unresponsive";
      state.error = "Worker heartbeat is stale. Execution is not confirmed; do not launch a duplicate. Request cancellation and inspect the worker or partial reports.";
    }
  }
  return state;
}
export async function startJob(root: string, key: string, spec: JobSpec): Promise<JobState> {
  if (!key.trim() || key.length > 128) throw new Error("idempotencyKey must contain 1 to 128 characters");
  const id = jobId(key), dir = path.join(root, id);
  try { await mkdir(dir, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await safeDirectory(root, id);
    // Another connection can observe the atomic reservation before its files exist.
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const previous = await readJson<JobSpec>(path.join(dir, "spec.json"));
        if (JSON.stringify(previous) !== JSON.stringify(spec))
          throw new Error("idempotencyKey already belongs to different run arguments. Reuse the original arguments or choose a new key.");
        return await readJob(root, id);
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code !== "ENOENT") throw readError;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    throw new Error("Run reservation is incomplete; no duplicate was started. Inspect the job directory before retrying with a new key.");
  }
  const state: JobState = { runId: id, status: "starting", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ownerPid: process.pid, bootTimeMs: Date.now() - os.uptime() * 1000, outputDir: path.relative(spec.workspace, spec.outputDir) };
  await atomicJson(path.join(dir, "spec.json"), spec);
  await atomicJson(path.join(dir, "state.json"), state);
  const child = spawn(process.execPath, [worker, root, id], {
    cwd: spec.workspace, env: process.env, detached: true, windowsHide: true, stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); }).catch(async error => {
    state.status = "failed"; state.error = String(error); await atomicJson(path.join(dir, "state.json"), state); throw error;
  });
  child.on("exit", () => {
    void (async () => {
      const current = await readJson<JobState>(path.join(dir, "state.json"));
      if (current.status === "starting") {
        current.status = "interrupted";
        current.error = "Evaluation worker exited before startup completed. No retry was launched.";
        current.updatedAt = new Date().toISOString();
        await atomicJson(path.join(dir, "state.json"), current);
      }
    })().catch(() => {});
  });
  child.unref();
  // The worker owns lifecycle from here, independently of the MCP connection.
  for (let attempt = 0; attempt < 100; attempt++) {
    const current = await readJob(root, id);
    if (current.status !== "starting") return current;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return readJob(root, id);
}
export async function cancelJob(root: string, id: string): Promise<JobState> {
  const state = await readJob(root, id);
  if (!terminal.has(state.status)) {
    const dir = await safeDirectory(root, id);
    await writeFile(path.join(dir, "cancel"), "cancel\n", { flag: "wx", mode: 0o600 }).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
  }
  return state;
}
export async function reportFiles(workspace: string, output: string): Promise<{ reports: string[]; reportsTruncated: boolean }> {
  const reports: string[] = [];
  let bytes = 0, reportsTruncated = false;
  // Breadth-first discovery lists iteration summaries before bulky case artifacts.
  const pending = [output];
  while (pending.length && !reportsTruncated) {
    const dir = pending.shift()!;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile() && /\.(json|xml|html)$/.test(entry.name)) {
        const relative = path.relative(workspace, file);
        bytes += Buffer.byteLength(JSON.stringify(relative));
        if (reports.length >= 256 || bytes > 32 * 1024) { reportsTruncated = true; break; }
        reports.push(relative);
      }
    }
  }
  return { reports: reports.sort(), reportsTruncated };
}
export async function executeJob(root: string, id: string) {
  const dir = await safeDirectory(root, id);
  const spec = await readJson<JobSpec>(path.join(dir, "spec.json"));
  let state = await readJson<JobState>(path.join(dir, "state.json"));
  state = { ...state, status: "running", ownerPid: process.pid, updatedAt: new Date().toISOString() };
  await atomicJson(path.join(dir, "state.json"), state);
  const controller = new AbortController();
  await writeFile(path.join(dir, "heartbeat"), "alive\n", { mode: 0o600 });
  let heartbeat = Promise.resolve();
  const pulse = setInterval(() => {
    heartbeat = heartbeat.then(() => writeFile(path.join(dir, "heartbeat"), "alive\n")).catch(() => { controller.abort(); });
  }, 5000);
  const stop = () => controller.abort();
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  const poll = setInterval(() => {
    void stat(path.join(dir, "cancel")).then(stop, error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") controller.abort();
    });
  }, 100);
  try {
    try { await stat(path.join(dir, "cancel")); controller.abort(); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const result = await runMcpCli(spec.argv, spec.workspace, controller.signal, spec.timeoutSeconds);
    state = { ...state, ...result,
      stdout: result.stdout.slice(0, 2000), stderr: result.stderr.slice(0, 2000),
      truncated: result.truncated || result.stdout.length > 2000 || result.stderr.length > 2000,
      status: result.exitCode === 0 ? "completed" : "failed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.status = controller.signal.aborted ? "cancelled" : message.includes("time limit") ? "timed_out" : "failed";
    state.error = message;
  } finally {
    clearInterval(poll);
    clearInterval(pulse);
    await heartbeat;
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
    state.updatedAt = new Date().toISOString();
    Object.assign(state, await reportFiles(spec.workspace, spec.outputDir).catch(() => ({ reports: [], reportsTruncated: false })));
    await atomicJson(path.join(dir, "state.json"), state);
  }
}
