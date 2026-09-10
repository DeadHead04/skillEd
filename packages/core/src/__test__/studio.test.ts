import test from "node:test";
import assert from "node:assert/strict";
import {
  assessPackage,
  profileHash,
  summarizeAreaEvidence,
  validateCoverage,
  validateInitialVerification,
} from "../studio";
import { materialVisibility, parseSkillMetadata } from "../intake";
import { NORMALIZATION_VERSION } from "../grading";
import { deriveResult } from "../results";
import { CoveragePlanSchema } from "../contracts";

test("minimal standard Skill is sufficient structurally without optional folders", () => {
  const result = assessPackage({
    name: "sample",
    packageHash: "hash",
    entries: [{ path: "SKILL.md" }],
    texts: {
      "SKILL.md":
        "---\nname: sample\ndescription: Test inputs against approved rules.\n---\nUse the supplied task.",
    },
  });
  assert.equal(result.valid, true);
  assert.equal(result.findings.length, 0);
  assert.equal(result.runtime, "not_checked");
});
test("package references carry source locations and cannot escape the root", () => {
  const result = assessPackage({
    name: "sample",
    packageHash: "hash",
    entries: [{ path: "SKILL.md" }],
    texts: {
      "SKILL.md":
        "---\nname: sample\ndescription: Test.\n---\nRead [rules](references/rules.md).\nRead [outside](../outside.md).",
    },
  });
  assert.equal(result.valid, false);
  assert.deepEqual(
    result.references.map((r) => r.line),
    [5, 6],
  );
  assert.equal(result.findings[1]?.code, "REFERENCE_ESCAPE");
});
test("metadata enforces standard name and description limits", () => {
  for (const name of ["Upper", "double--hyphen", "a".repeat(65)])
    assert.throws(() =>
      parseSkillMetadata(`---\nname: ${name}\ndescription: Test\n---\n`),
    );
  assert.throws(() =>
    parseSkillMetadata(
      `---\nname: sample\ndescription: ${"x".repeat(1025)}\n---\n`,
    ),
  );
});
test("custom outcome roles retain FAIL versus PARTIAL semantics", () => {
  assert.equal(
    deriveResult([
      {
        dimension: "invoice-total",
        role: "task_success",
        required: true,
        passed: false,
      },
    ]),
    "FAIL",
  );
  assert.equal(
    deriveResult([
      {
        dimension: "locked-cells",
        role: "constraint",
        required: true,
        passed: false,
      },
    ]),
    "PARTIAL",
  );
});
test("area counts include missing, duplicate, and invalid observations", () => {
  const cases = [
    {
      case_id: "A",
      assertion_mapping: {
        criterion: { id: "A-1", areaId: "accuracy", required: true },
      },
      required_dimensions: ["accuracy"],
    },
  ];
  const rows = [
    {
      case_id: "A",
      iteration: 1,
      configuration: "skill",
      result: "PASS",
      assertions: [{ id: "A-1", passed: true }],
    },
    {
      case_id: "A",
      iteration: 2,
      configuration: "skill",
      result: "ERROR",
      assertions: [],
    },
  ];
  const [a] = summarizeAreaEvidence([], cases, rows, 3);
  assert.deepEqual([a?.expected, a?.pass, a?.error, a?.missing], [3, 1, 1, 1]);
});
test("required task areas cannot approve empty or unrelated coverage", () => {
  const plan = CoveragePlanSchema.parse({
    areas: [
      {
        id: "accuracy",
        label: "Accuracy",
        description: "Matches the supplied authority",
        role: "task_success",
        required: true,
        sourceReferences: [],
      },
    ],
    groups: [
      {
        name: "Core",
        purpose: "Correctness",
        caseCount: 1,
        judge: "agent",
        dimensions: ["accuracy"],
        provenance: [],
        iterations: 1,
      },
    ],
  });
  assert.throws(() => validateCoverage(plan, []), /Coverage count/);
  assert.throws(
    () => validateCoverage({ ...plan, areas: [...plan.areas, ...plan.areas] }),
    /Duplicate/,
  );
});

test("initial activation requires complete current-pipeline evidence, not an empty PASS label", () => {
  const run = {
    status: "completed",
    iterations: 3,
    baseline: false,
    provenance_status: "verified_pipeline",
    engine_versions: {
      adapter: "demo",
      normalizationVersion: NORMALIZATION_VERSION,
    },
  };
  const cases = [
    {
      case_id: "FIRST",
      assertion_mapping: {
        correct: {
          id: "FIRST-correct",
          dimension: "task-outcome",
          required: true,
        },
      },
    },
  ];
  const results = [1, 2, 3].map((iteration) => ({
    case_id: "FIRST",
    configuration: "skill",
    iteration,
    result: "PASS",
    assertions: [{ id: "FIRST-correct", passed: true }],
  }));
  assert.doesNotThrow(() =>
    validateInitialVerification(run, cases, results, "demo"),
  );
  assert.throws(
    () => validateInitialVerification(run, cases, results.slice(0, 2), "demo"),
    /Incomplete/,
  );
  assert.throws(
    () => validateInitialVerification(run, cases, results, "real"),
    /current execution pipeline/,
  );
  assert.throws(
    () =>
      validateInitialVerification(
        run,
        cases,
        results.map((r) => ({ ...r, assertions: [] })),
        "demo",
      ),
    /missing or invalid/,
  );
});
test("public task rules can be staged while hidden answers remain judge-only", () => {
  assert.equal(materialVisibility("dataset"), "agent_input");
  assert.equal(materialVisibility("authority"), "judge_only");
  assert.equal(materialVisibility("authority", "agent_input"), "agent_input");
  assert.throws(
    () => materialVisibility("expected", "agent_input"),
    /judge-only/,
  );
});

test("profile approval hash survives JSONB key ordering", () => {
  assert.equal(
    profileHash({ areas: [], groups: [] }, { inputs: [], outputs: [] }),
    profileHash({ groups: [], areas: [] }, { outputs: [], inputs: [] }),
  );
});

test("folder identity and structured Codex dependencies are assessed without treating comments as requirements", () => {
  const input = {
    name: "sample",
    packageHash: "hash",
    entries: [{ path: "SKILL.md" }, { path: "agents/openai.yaml" }],
    texts: {
      "SKILL.md": "---\nname: sample\ndescription: Example\n---\nDo the task.",
      "agents/openai.yaml": "# type: mcp\ninterface:\n  display_name: Sample",
    },
  };
  assert.equal(
    assessPackage({ ...input, selectedRoot: "sample" }).runtime,
    "not_checked",
  );
  assert.equal(
    assessPackage({ ...input, selectedRoot: "different" }).valid,
    false,
  );
  assert.equal(
    assessPackage({
      ...input,
      texts: {
        ...input.texts,
        "agents/openai.yaml":
          "dependencies:\n  tools:\n    - type: mcp\n      value: example",
      },
    }).runtime,
    "unsupported",
  );
});

test("trial and baseline selection keep manifest denominators and distinguish unavailable evidence", () => {
  const cases = [
    {
      case_id: "A",
      required_dimensions: ["accuracy"],
      assertion_mapping: {
        one: { id: "A-1", areaId: "accuracy", required: true },
        two: { id: "A-2", areaId: "accuracy", required: true },
      },
    },
  ];
  const row = (
    iteration: number,
    configuration: string,
    assertions: any[],
    result = "PASS",
  ) => ({ case_id: "A", iteration, configuration, result, assertions });
  const rows = [
    row(1, "with_skill", [
      { id: "A-1", passed: true },
      { id: "A-2", passed: true },
    ]),
    row(
      2,
      "skill",
      [
        { id: "A-1", passed: false },
        { id: "A-2", passed: true },
      ],
      "FAIL",
    ),
    row(1, "without_skill", [
      { id: "A-1", passed: true },
      { id: "A-1", passed: true },
    ]),
    row(2, "baseline", [
      { id: "A-1", passed: true },
      { id: "A-2", passed: true },
    ]),
    row(2, "baseline", [
      { id: "A-1", passed: true },
      { id: "A-2", passed: true },
    ]),
  ];
  const counts = (variant: string, trial?: number) => {
    const a = summarizeAreaEvidence([], cases, rows, 3, variant, trial)[0]!;
    assert.equal(a.expected, a.pass + a.fail + a.error + a.missing);
    return [a.expected, a.pass, a.fail, a.error, a.missing];
  };
  assert.deepEqual(counts("skill"), [6, 3, 1, 0, 2]);
  assert.deepEqual(counts("skill", 1), [2, 2, 0, 0, 0]);
  assert.deepEqual(counts("skill", 2), [2, 1, 1, 0, 0]);
  assert.deepEqual(counts("skill", 3), [2, 0, 0, 0, 2]);
  assert.deepEqual(counts("baseline", 1), [2, 0, 0, 2, 0]);
  assert.deepEqual(counts("baseline", 2), [2, 0, 0, 2, 0]);
  assert.deepEqual(counts("baseline", 3), [2, 0, 0, 0, 2]);
  assert.throws(() => counts("skill", 4), /outside the execution manifest/);
  assert.throws(() => counts("skill", 1.5), /outside the execution manifest/);
});
