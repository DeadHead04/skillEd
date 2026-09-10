import test from "node:test";
import assert from "node:assert/strict";
import { validatedGeneration } from "./validated-generation.js";
import {
  validateGeneratedSuite,
  generationSchemaForPlan,
} from "./eval-validation.js";
import { CoveragePlanSchema } from "@skilled/core";

const materialId = "11111111-1111-4111-8111-111111111111";
const plan = CoveragePlanSchema.parse({
  areas: [
    {
      id: "decisions",
      label: "Decisions",
      description: "Correct decisions",
      role: "task_success",
      required: true,
      sourceReferences: [],
    },
  ],
  groups: [
    {
      name: "normal",
      purpose: "Core decision",
      caseCount: 1,
      judge: "script",
      dimensions: ["decisions"],
      provenance: ["task"],
      iterations: 1,
    },
  ],
});
const fixture = () => ({
  cases: [
    {
      id: "CASE-1",
      title: "Grounded decision",
      coverageGroup: "normal",
      purpose: "Decision",
      prompt: "Write result.json",
      judgeType: "script",
      dimensions: ["decisions"],
      criteria: ["Result matches"],
      provenance: ["task"],
      sourceReferences: [{ materialId, location: "task rule" }],
      assertions: [
        {
          id: "DECISION-1",
          areaId: "decisions",
          role: "task_success",
          required: true,
          text: "Result matches",
        },
      ],
      deterministicChecks: [
        {
          assertionId: "DECISION-1",
          dimension: "decisions",
          kind: "equals",
          file: "result.json",
          format: "json",
          selector: "/decision",
          value: "FAIL",
          allowedPaths: [],
        },
      ],
    },
  ],
});
const materials = [{ id: materialId, path: "inputs/task.json" }];

test("the Codex response contract requires every approved coverage group and exact counts", () => {
  const twoGroups = {
    ...plan,
    groups: [...plan.groups, { ...plan.groups[0]!, name: "boundary" }],
  };
  const schema = generationSchemaForPlan(twoGroups);
  const batch = fixture().cases[0]!;
  assert.throws(() => schema.parse({ casesByGroup: { normal: [batch] } }));
  assert.throws(() =>
    schema.parse({ casesByGroup: { normal: [batch], boundary: [batch] } }),
  );
  const boundary = { ...batch, coverageGroup: "boundary", id: "CASE-2" };
  assert.equal(
    Object.keys(
      schema.parse({ casesByGroup: { normal: [batch], boundary: [boundary] } })
        .casesByGroup,
    ).length,
    2,
  );
  assert.throws(() =>
    schema.parse({
      casesByGroup: { normal: [batch, batch], boundary: [boundary] },
    }),
  );
});

test("invalid real authoring receives bounded correction without accepting missing evidence", async () => {
  const rejected: string[] = [];
  const result = await validatedGeneration({
    generate: async (feedback, attempt) => {
      const proposal = fixture();
      if (attempt === 1) proposal.cases[0]!.deterministicChecks = [];
      else assert.match(feedback, /no explicit script validator/);
      return proposal;
    },
    validate: (value) => validateGeneratedSuite(value, plan, materials),
    rejected: async (_, error) => {
      rejected.push(error);
    },
  });
  assert.equal(result.cases.length, 1);
  assert.equal(rejected.length, 1);
  let attempts = 0;
  await assert.rejects(
    validatedGeneration({
      generate: async () => {
        attempts++;
        return {};
      },
      validate: (value) => validateGeneratedSuite(value, plan, materials),
      rejected: async () => {},
    }),
    /after 3 attempts/,
  );
  assert.equal(attempts, 3);
});

test("generated validators reject nonexistent truth, unsafe paths and incorrect area mappings", () => {
  const original = fixture();
  for (const patch of [
    { kind: "unchanged", expectedMaterialId: "invented-fixture" },
    { file: "../hidden.json" },
    { dimension: "another-area" },
    {
      kind: "unchanged",
      expectedMaterialId: materialId,
      allowedPaths: ["review.json"],
    },
  ]) {
    const proposal = structuredClone(original);
    Object.assign(proposal.cases[0]!.deterministicChecks[0]!, patch);
    assert.throws(() => validateGeneratedSuite(proposal, plan, materials));
  }
  assert.equal(
    validateGeneratedSuite(original, plan, materials).cases.length,
    1,
  );
});
