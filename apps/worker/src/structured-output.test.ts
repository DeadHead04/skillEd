import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  AuthoringIntakeSchema,
  AuthoringRevisionSchema,
  CoveragePlanSchema,
  GeneratedEvalSuiteSchema,
  UpdateProposalOutputSchema,
  GeneratedEvalCaseSchema,
  SkillFileChangeSchema,
} from "@skilled/core";
import {
  codexOutputSchema,
  restoreOptionalFields,
} from "./structured-output.js";

test("every production Codex response schema declares all nested properties required", () => {
  let objects = 0;
  const inspect = (schema: any) => {
    if (!schema || typeof schema !== "object") return;
    if (schema.properties) {
      objects++;
      assert.deepEqual(
        schema.required.sort(),
        Object.keys(schema.properties).sort(),
      );
      assert.equal(schema.additionalProperties, false);
    }
    for (const item of Object.values(schema)) inspect(item);
  };
  for (const schema of [
    AuthoringIntakeSchema,
    AuthoringRevisionSchema,
    CoveragePlanSchema,
    GeneratedEvalSuiteSchema,
    UpdateProposalOutputSchema,
  ])
    inspect(codexOutputSchema(z.toJSONSchema(schema)));
  assert.ok(objects > 20);
});

test("nullable transport fields preserve null assertions and restore omitted patch fields", () => {
  const checkSchema = GeneratedEvalCaseSchema.shape.deterministicChecks;
  const checks = restoreOptionalFields(
    [
      {
        assertionId: "CHECK-1",
        kind: "equals",
        value: null,
        dimension: "output",
        file: "result.json",
        format: "json",
        selector: "/empty",
        expectedMaterialId: null,
        allowedPaths: [],
      },
    ],
    z.toJSONSchema(checkSchema),
  );
  assert.equal(checkSchema.parse(checks)[0]!.value, null);
  assert.equal(Object.hasOwn(checks[0], "expectedMaterialId"), false);
  const patch = restoreOptionalFields(
    {
      path: "SKILL.md",
      action: "replace",
      content: "Updated instructions",
      from: null,
      reason: "Clarify missing evidence",
      targetAssertionIds: ["CHECK-1"],
    },
    z.toJSONSchema(SkillFileChangeSchema),
  );
  assert.equal(
    SkillFileChangeSchema.parse(patch).content,
    "Updated instructions",
  );
  assert.equal(Object.hasOwn(patch, "from"), false);
  // Required nulls are not repaired into invented values or silently omitted.
  assert.throws(() =>
    SkillFileChangeSchema.parse(
      restoreOptionalFields(
        { ...patch, path: null },
        z.toJSONSchema(SkillFileChangeSchema),
      ),
    ),
  );
  assert.deepEqual(
    restoreOptionalFields(
      { reply: "No change", revision: null },
      z.toJSONSchema(AuthoringRevisionSchema),
    ),
    { reply: "No change", revision: null },
  );
});
