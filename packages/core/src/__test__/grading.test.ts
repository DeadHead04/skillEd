import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeGrading,
  validateResultMatrix,
  compareVerification,
  type AssertionDefinition,
} from "../grading";
import { deriveResult, worstResult } from "../results";
const definitions: AssertionDefinition[] = [
  { id: "correct", text: "Correct", dimension: "correctness", required: true },
  { id: "scope", text: "Scope", dimension: "scope", required: true },
];
const raw = (status: string, values: unknown[]) => ({
  status,
  grading: { assertion_results: values },
});
test("missing, malformed, duplicate, and incomplete grading never passes", () => {
  for (const value of [
    { status: "FAIL" },
    raw("PASS", []),
    raw("PASS", [{ text: "Correct", passed: true }]),
    raw("PASS", [{ text: "Correct", passed: "false" }]),
    raw("PASS", [
      { text: "Correct", passed: true },
      { text: "Correct", passed: true },
    ]),
  ])
    assert.equal(normalizeGrading(value, definitions, "agent").result, "ERROR");
  assert.equal(deriveResult([]), "ERROR");
  assert.equal(worstResult([]), "ERROR");
});
test("real script wrapper shape maps stable IDs and retains PARTIAL", () => {
  const evidence = JSON.stringify({
    schemaVersion: "skilled-grading-v1",
    assertions: [
      { id: "correct", passed: true, evidence: "exact match" },
      { id: "scope", passed: false, evidence: "protected cell changed" },
    ],
    error: null,
  });
  const result = normalizeGrading(
    raw("FAIL", [{ text: "script: /tmp/check.py", passed: false, evidence }]),
    definitions,
    "script",
  );
  assert.equal(result.result, "PARTIAL");
  assert.equal(result.dimensions.scope, false);
});
test("script crashes and timeout prose are infrastructure, not task failures", () => {
  for (const evidence of [
    "script timed out after 1s",
    "script exited with code 1",
  ]) {
    const result = normalizeGrading(
      raw("FAIL", [{ text: "script: check", passed: false, evidence }]),
      definitions,
      "script",
    );
    assert.equal(result.result, "ERROR");
    assert.equal(result.errorClass, "judge_execution");
  }
});
test("expected report matrix requires every configuration and iteration exactly once", () => {
  const rows = [1, 2].flatMap((iteration) =>
    ["with_skill", "without_skill"].map((configuration) => ({
      case_id: "C1",
      configuration,
      iteration,
    })),
  );
  validateResultMatrix(rows, ["C1"], true, 2);
  assert.throws(
    () => validateResultMatrix(rows.slice(1), ["C1"], true, 2),
    /Incomplete/,
  );
  assert.throws(
    () => validateResultMatrix([...rows, rows[0]!], ["C1"], true, 2),
    /duplicate/,
  );
});
test("verification rejects hidden assertion regressions despite equal overall FAIL labels", () => {
  const rows = (scope: boolean) =>
    [1, 2, 3].map((iteration) => ({
      case_id: "C1",
      configuration: "skill",
      iteration,
      result: "FAIL",
      assertions: [
        { id: "correct", required: true, passed: false },
        { id: "scope", required: true, passed: scope },
      ],
    }));
  const result = compareVerification(rows(true), rows(false), ["C1"], 3);
  assert.equal(result.blocked, true);
  assert.equal(result.cases[0]?.category, "Regressed");
  assert.equal(compareVerification([], [], ["C1"], 3).blocked, true);
});
