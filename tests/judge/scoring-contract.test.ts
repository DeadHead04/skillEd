import test from "node:test";
import assert from "node:assert/strict";
import { decode } from "../../src/contracts/decode.js";
import type { JudgeConfig } from "../../src/contracts/schema.js";
import { RuleBasedJudge } from "../../src/judge/rule-based.js";
import { compareResults } from "../../src/report/compare.js";
import { parseJSONInput } from "../../src/cli/json-input.js";
import { convertToAnthropicGrading } from "../../src/report/grading.js";
import { writeMarkdownCaseDetails } from "../../src/report/markdown.js";
import { newCaseResult } from "../../src/report/reporter.js";
import type { Result } from "../../src/judge/types.js";

function report(grading: Result) {
  return { skill_name: "contract", schema_version: "v1alpha1", engine_name: "real-judge", model_name: "none",
    case_results: [{ case_id: "one", configuration: "with_skill", prompt: "fixed input", status: grading.status, grading }] };
}
test("real rule results keep negative checks and skipped denominator; unchanged criteria compare across outcomes", async () => {
  const cfg = decode<JudgeConfig>("JudgeConfig", { type: "rule_based", failure: [{ output_contains: { all: ["forbidden"] } }],
    success: [{ output_contains: { all: ["required"] } }] });
  const judge = new RuleBasedJudge(cfg);
  const pass = await judge.evaluate({ finalMessage: "required" });
  const fail = await judge.evaluate({ finalMessage: "forbidden" });
  assert.deepEqual(pass.summary, { passed: 2, failed: 0, total: 2, pass_rate: 1 });
  assert.deepEqual(fail.summary, { passed: 0, failed: 2, total: 2, pass_rate: 0 });
  assert.equal(fail.assertion_results[1].skipped, true);
  assert.deepEqual(pass.assertion_results.map(a => a.id), fail.assertion_results.map(a => a.id));
  assert.notEqual(pass.assertion_results[0].text, fail.assertion_results[0].text);
  const result = compareResults(report(pass), report(fail));
  assert.equal(result.summary.comparableScores, 1);
  assert.deepEqual(result.cases[0].score, { before: 1, after: 0, delta: -1 });
  const changed = await new RuleBasedJudge({ ...cfg, success: [] }).evaluate({ finalMessage: "forbidden" });
  assert.equal(compareResults(report(pass), report(changed)).summary.comparableScores, 0);
  assert.equal(compareResults(report(pass), report({ ...fail, scoring_version: "future" })).summary.comparableScores, 0);
  const decoded = parseJSONInput<Result>("judge.Result", JSON.stringify(fail));
  assert.deepEqual(decoded.summary, fail.summary);
  assert.equal(decoded.rubric_id, fail.rubric_id);
  assert.equal(decoded.assertion_results[1].skipped, true);
  assert.deepEqual(decoded.assertion_results.map(a => a.id), fail.assertion_results.map(a => a.id));
  assert.equal(convertToAnthropicGrading(decoded).expectations![1].skipped, true);
  assert.match(writeMarkdownCaseDetails(newCaseResult({ case_id: "one", grading: decoded })), /Skipped: success rule 1/);
});
test("negative-only passing case is scored and empty rubric remains unscored", async () => {
  const cfg = decode<JudgeConfig>("JudgeConfig", { failure: [{ output_contains: { all: ["forbidden"] } }] });
  const passing = await new RuleBasedJudge(cfg).evaluate({ finalMessage: "clear" });
  assert.deepEqual(passing.summary, { passed: 1, failed: 0, total: 1, pass_rate: 1 });
  const empty = await new RuleBasedJudge({ success: [], failure: [] }).evaluate({});
  assert.equal(compareResults(report(empty), report(empty)).summary.comparableScores, 0);
});
