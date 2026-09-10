import { GeneratedEvalCaseSchema } from "./contracts";
/** Rebind immutable copied materials without retaining references into the old eval. */
export function remapCaseMaterials(value: unknown, ids: Map<string, string>) {
  const definition = GeneratedEvalCaseSchema.parse(value);
  const remap = (id: string) => {
    const next = ids.get(id);
    if (!next) throw new Error(`Unknown material reference: ${id}`);
    return next;
  };
  definition.sourceReferences = definition.sourceReferences.map(
    (reference) => ({ ...reference, materialId: remap(reference.materialId) }),
  );
  definition.deterministicChecks = definition.deterministicChecks.map(
    (check) => ({
      ...check,
      expectedMaterialId: check.expectedMaterialId
        ? remap(check.expectedMaterialId)
        : undefined,
    }),
  );
  for (const [before, after] of ids) {
    definition.prompt = definition.prompt.replaceAll(
      `inputs/${before}-`,
      `inputs/${after}-`,
    );
    for (const check of definition.deterministicChecks)
      if (check.file)
        check.file = check.file.replaceAll(
          `inputs/${before}-`,
          `inputs/${after}-`,
        );
  }
  return definition;
}
