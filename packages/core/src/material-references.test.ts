import test from "node:test";
import assert from "node:assert/strict";
import { remapCaseMaterials } from "./material-references";
test("derived evals bind fixture paths, source references and protected truth to copied material IDs", () => {
  const original = crypto.randomUUID(),
    copied = crypto.randomUUID();
  const source = {
    id: "CASE-1",
    title: "Fixture",
    coverageGroup: "Files",
    purpose: "Preserve fields",
    prompt: `Read inputs/${original}-data.json`,
    judgeType: "script",
    dimensions: ["scope"],
    provenance: ["supplied truth"],
    sourceReferences: [{ materialId: original, location: "protected field" }],
    criteria: ["Preserve protected fields"],
    deterministicChecks: [
      {
        kind: "unchanged",
        dimension: "scope",
        file: "output.json",
        format: "json",
        expectedMaterialId: original,
        allowedPaths: ["/target"],
      },
    ],
  };
  const result = remapCaseMaterials(source, new Map([[original, copied]]));
  assert.equal(result.sourceReferences[0]!.materialId, copied);
  assert.equal(result.deterministicChecks[0]!.expectedMaterialId, copied);
  assert.equal(result.prompt, `Read inputs/${copied}-data.json`);
  assert.equal(source.sourceReferences[0]!.materialId, original);
  assert.throws(
    () => remapCaseMaterials(source, new Map()),
    /Unknown material/,
  );
});
