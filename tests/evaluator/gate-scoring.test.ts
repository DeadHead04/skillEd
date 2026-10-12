import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { decode } from "../../src/contracts/decode.js";
import type { CaseConfig, EvalConfig, JudgeConfig } from "../../src/contracts/schema.js";
import { DefaultEvaluator } from "../../src/evaluator/evaluator.js";
import type { EvalResult } from "../../src/evaluator/types.js";
import { ClaudeCodeAgent } from "../../src/agent/claude-code.js";
import { NoneRuntime } from "../../src/runtime/none.js";
import { resultToBenchmarkRun } from "../../src/runner/index.js";
import { computeAnthropicBenchmark } from "../../src/report/benchmark-anthropic.js";

// Grade completed session data through the production evaluator and real host
// runtime. These offline tests make no claim about model execution quality.
async function grade(t: test.TestContext, message: string, judgeData: object, multi = false) {
  const dir = await mkdtemp(path.join(tmpdir(), "skilled-gate-score-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const judge = decode<JudgeConfig>("JudgeConfig", judgeData);
  const cfg = decode<CaseConfig>("CaseConfig", {
    id: "summary", expect: { must_contain: ["Summary"], must_not_contain: ["TODO"], exit_code: 0 },
    ...(multi ? { judges: [{ id: "quality", ...judgeData }] } : { judge }),
  });
  const evalCfg = decode<EvalConfig>("EvalConfig", { engine: { name: "claude_code" }, judge });
  const rt = new NoneRuntime({ type: "none", workspaceDir: dir });
  await rt.create();
  const ev = new DefaultEvaluator({ evalCfg, skillDir: dir, outputDir: dir });
  const result: EvalResult = {
    caseID: "summary", caseName: "Summary", prompt: "Summarize", status: "PASS",
    configuration: "with_skill", turnsTotal: 1, turns: 1, duration_ms: 1,
    exit_code: 0, final_message: message, transcript: [],
  };
  return ev.evaluateCaseSession(rt, cfg, "with_skill", judge, 1,
    new ClaudeCodeAgent({ name: "claude_code" }), result, result);
}

const rubric = { type: "rule_based", success: ["A", "B", "C", "D"].map(x => ({ output_contains: { all: [x] } })) };

test("gate failure cannot outrank partial judge success in the actual benchmark", async t => {
  const failed = await grade(t, "Summary: TODO", rubric);
  const partial = await grade(t, "Summary: A", rubric);
  assert.equal(failed.status, "FAIL");
  assert.equal(failed.expectResult?.passed, false);
  assert.equal(failed.grading?.status, "SKIP");
  assert.equal(failed.grading?.skip_reason, "expect_gate_failed");
  assert.deepEqual(failed.grading?.summary, { passed: 0, failed: 0, total: 0, pass_rate: 0 });
  assert.deepEqual(failed.grading?.assertion_results, []);
  assert.equal(partial.status, "FAIL");
  assert.equal(partial.expectResult?.passed, true);
  assert.deepEqual(partial.grading?.summary, { passed: 1, failed: 3, total: 4, pass_rate: 0.25 });
  const benchmark = computeAnthropicBenchmark("summary", ".", [resultToBenchmarkRun(failed, 1)], [resultToBenchmarkRun(partial, 1)]);
  assert.equal(Number(benchmark.run_summary.delta?.pass_rate), -0.25);
});

test("passing gates award no extra rubric assertions and preserve full credit", async t => {
  const result = await grade(t, "Summary: A B C D", rubric);
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.grading?.summary, { passed: 4, failed: 0, total: 4, pass_rate: 1 });
});

test("failed gate never executes a script with an unknown assertion count", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "skilled-gate-script-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const script = path.join(dir, "judge.sh"), marker = path.join(dir, "invoked");
  await writeFile(script, `#!/bin/sh\ntouch '${marker}'\n`);
  for (const multi of [false, true]) {
    const result = await grade(t, "TODO", { type: "script", script_path: script }, multi);
    assert.equal(result.status, "FAIL");
    assert.equal(result.grading?.status, "SKIP");
    if (multi) assert.deepEqual(result.judgeResults?.map(j => [j.status, j.skip_reason]), [["SKIP", "gate_failed"]]);
  }
  await assert.rejects(stat(marker), { code: "ENOENT" });
});
