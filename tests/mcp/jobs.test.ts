import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { jobId, readJob, reportFiles } from "../../src/mcp/jobs.js";

test("a real broken worker installation produces interrupted startup, not perpetual starting", { timeout: 15000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skilled-broken-worker-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  // Copy production modules, deliberately omit job-worker.js to reproduce an incomplete installation.
  for (const name of ["jobs.js", "process.js", "supervision.js"]) await cp(new URL(`../../src/mcp/${name}`, import.meta.url), path.join(root, name));
  const jobsRoot = path.join(root, "jobs"), outputDir = path.join(root, "reports");
  await mkdir(jobsRoot); await mkdir(outputDir);
  const module = await import(pathToFileURL(path.join(root, "jobs.js")).href);
  const result = await module.startJob(jobsRoot, "startup-failure", { workspace: root, argv: ["--version"], outputDir, timeoutSeconds: 5 });
  assert.equal(result.status, "interrupted");
  assert.match(result.error, /startup/);
});

test("status derives interrupted state without mutating the worker-owned record", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skilled-job-state-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = jobId("dead-worker"), directory = path.join(root, id);
  await mkdir(directory);
  const state = { runId: id, status: "running", ownerPid: 0, outputDir: "reports", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await writeFile(path.join(directory, "state.json"), JSON.stringify(state));
  assert.equal((await readJob(root, id)).status, "interrupted");
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, "state.json"), "utf8")), state);
});

test("report discovery bounds large actual directories", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skilled-many-reports-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all(Array.from({ length: 300 }, (_, index) => writeFile(path.join(root, `${index}.json`), "{}")));
  const result = await reportFiles(root, root);
  assert.equal(result.reports.length, 256);
  assert.equal(result.reportsTruncated, true);
});

test("stale heartbeat cannot be mistaken for a live worker after PID reuse", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skilled-stale-heartbeat-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = jobId("stale"), directory = path.join(root, id);
  await mkdir(directory);
  const state = { runId: id, status: "running", ownerPid: process.pid, outputDir: "reports", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };
  await writeFile(path.join(directory, "state.json"), JSON.stringify(state));
  assert.equal((await readJob(root, id)).status, "unresponsive");
  await writeFile(path.join(directory, "state.json"), JSON.stringify({ ...state, status: "starting" }));
  assert.equal((await readJob(root, id)).status, "unresponsive");
  await writeFile(path.join(directory, "state.json"), JSON.stringify(state));
  await writeFile(path.join(directory, "heartbeat"), "alive\n");
  assert.equal((await readJob(root, id)).status, "running");
});
