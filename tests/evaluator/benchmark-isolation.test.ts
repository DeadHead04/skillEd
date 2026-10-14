import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { decode } from "../../src/contracts/decode.js";
import type { EvalConfig, CaseConfig } from "../../src/contracts/schema.js";
import { assertBenchmarkIsolation } from "../../src/evaluator/benchmark-isolation.js";
import { newEvaluator, buildPlan } from "../../src/evaluator/index.js";
import { newRunner } from "../../src/runner/index.js";
import { Loader } from "../../src/config/loader.js";
import { detectAgent } from "../../src/agent/factory.js";

test("native baseline is rejected before credentials, execution, or output mutation", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skilled-benchmark-guard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "evals"));
  await writeFile(path.join(root, "SKILL.md"), "---\nname: sample\ndescription: Sample\n---\nPolicy\n");
  const cfg = decode<EvalConfig>("EvalConfig", { environment: { type: "none" }, benchmark: { enabled: true } });
  const loader = await Loader.create(path.join(root, "evals/eval.yaml"));
  const cases = [decode<CaseConfig>("CaseConfig", { id: "policy", input: { prompt: "check" } })];
  const runner = newRunner(cfg, loader);
  await assert.rejects(runner.buildExecutionPlan(cases, { outputDir: path.join(root, "reports") }), /native none workspaces do not restrict reads/);
  const evaluator = newEvaluator({ evalCfg: cfg, withBaseline: true });
  await assert.rejects(evaluator.evaluateAll(cases), /benchmark requires the verified isolated runtime/);
  cfg.benchmark.enabled = false;
  const direct = newEvaluator({ evalCfg: cfg });
  const tasks = buildPlan(cases, 1, 1, ["without_skill"]).iterations[0].tasks;
  await assert.rejects(direct.evaluatePlan(tasks), /benchmark requires the verified isolated runtime/);
  await assert.rejects(direct.executeCase(cases[0], "without_skill"), /benchmark requires the verified isolated runtime/);
  assert.deepEqual((await readdir(root)).sort(), ["SKILL.md", "evals"]);
  assert.doesNotThrow(() => assertBenchmarkIsolation(cfg, false));
});

test("baseline requires a case-local execution boundary", () => {
  const cfg = decode<EvalConfig>("EvalConfig", { environment: { type: "docker", image: "node:22" } });
  assert.doesNotThrow(() => assertBenchmarkIsolation(cfg, true));
  assert.throws(() => assertBenchmarkIsolation(cfg, true, "/project"), /external workspace/);
  cfg.engine.custom = decode("CustomEngineConfig", { transport: "http" });
  assert.throws(() => assertBenchmarkIsolation(cfg, true), /HTTP engine/);
  cfg.environment.type = "opensandbox";
  assert.throws(() => assertBenchmarkIsolation(cfg, true), /OpenSandbox benchmarks/);
});

test("real Docker benchmark grades both variants outside the agent-modified system", {
  skip: process.env.SKILLED_DOCKER_INTEGRATION !== "1",
  timeout: 120000,
}, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skilled-grading-boundary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "evals"));
  await writeFile(path.join(root, "SKILL.md"), "---\nname: boundary\ndescription: Filesystem boundary check\n---\nInspect inputs.\n");
  const oracle = path.join(root, "evals/private-grader.sh");
  await writeFile(oracle, "#!/bin/sh\nset -eu\ntest ! -e /root/agent-persistence\ntest \"$(cat artifact.txt)\" = preserved\nprintf 'clean grader verified workspace artifact'\n");
  const config = decode<EvalConfig>("EvalConfig", {
    environment: { type: "docker", image: "node:22" },
    benchmark: { enabled: true },
    skills: [],
    engine: { name: "filesystem-probe", custom: {
      transport: "local", response_format: "session_result",
      local: { command: "node", args: ["probe.cjs", "${input_file}"] },
    } },
    judge: { type: "script", script_path: "evals/private-grader.sh" },
    cases: { retry_policy: { max_retries: 0 }, defaults: { timeout_seconds: 60 } },
  });
  const loader = await Loader.create(path.join(root, "evals/eval.yaml"));
  const agent = detectAgent(config.engine.name, { name: config.engine.name, custom: config.engine.custom });
  // This is a real custom process engine probing its OS filesystem, not a
  // replacement model response. Its side effects must not reach the grader.
  const probe = `const fs = require('node:fs');
if (fs.existsSync(${JSON.stringify(oracle)})) throw new Error('host oracle exposed');
fs.writeFileSync('/root/agent-persistence', 'untrusted system change');
fs.writeFileSync('artifact.txt', 'preserved');
console.log(JSON.stringify({exit_code:0, final_message:'filesystem probed'}));`;
  const cfg = decode<CaseConfig>("CaseConfig", {
    id: "boundary", input: { prompt: "Probe the filesystem boundary" },
    context: { files: { "probe.cjs": probe } },
  });
  const results = await newEvaluator({
    evalCfg: config, agent, loader, skillDir: root,
    withBaseline: true, concurrency: 2, deleteWorkspace: true,
    outputDir: path.join(root, "reports"),
  }).evaluateAll([cfg]);
  assert.deepEqual(results.map((r) => [r.configuration, r.status]), [
    ["with_skill", "PASS"], ["without_skill", "PASS"],
  ], results.map((r) => r.error?.message).join("\n"));
  for (const result of results)
    assert.match(result.grading!.assertion_results[0].evidence, /clean grader verified/);
});
