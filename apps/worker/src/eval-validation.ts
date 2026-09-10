import {
  GeneratedEvalSuiteSchema,
  GeneratedEvalCaseSchema,
  validateCoverage,
  type CoveragePlanSchema,
} from "@skilled/core";
import { z } from "zod";

export function generationSchemaForPlan(
  plan: z.infer<typeof CoveragePlanSchema>,
) {
  validateCoverage(plan);
  if (
    !plan.groups.length ||
    new Set(plan.groups.map((g) => g.name)).size !== plan.groups.length
  )
    throw new Error("Generation requires distinct approved coverage groups");
  return z.object({
    casesByGroup: z.object(
      Object.fromEntries(
        plan.groups.map((group) => [
          group.name,
          z
            .array(
              GeneratedEvalCaseSchema.extend({
                coverageGroup: z.literal(group.name),
              }),
            )
            .length(group.caseCount),
        ]),
      ),
    ),
    generationNotes: GeneratedEvalSuiteSchema.shape.generationNotes,
  });
}

export function validateGeneratedSuite(
  value: unknown,
  plan: z.infer<typeof CoveragePlanSchema>,
  materials: Array<{ id: string; path: string | null }>,
) {
  const suite = GeneratedEvalSuiteSchema.parse(value);
  validateCoverage(plan, suite.cases);
  if (new Set(suite.cases.map((c) => c.id)).size !== suite.cases.length)
    throw new Error("Duplicate generated case IDs");
  for (const item of suite.cases) {
    if (
      !item.sourceReferences.length ||
      item.sourceReferences.some(
        (ref) => !materials.some((m) => m.id === ref.materialId),
      )
    )
      throw new Error(
        `${item.id}: source references must use actual material IDs`,
      );
    for (const check of item.deterministicChecks) {
      if (
        check.file &&
        (/^[\\/]|^[a-z]:/i.test(check.file) ||
          check.file.split(/[\\/]/).includes(".."))
      )
        throw new Error(
          `${item.id}: validator file must remain in the case workspace`,
        );
      const assertion = item.assertions.find(
        (a) => a.id === check.assertionId,
      )!;
      if (check.dimension !== assertion.areaId)
        throw new Error(
          `${check.assertionId}: validator area must match its assertion`,
        );
      if (check.kind === "unchanged") {
        if (
          !check.file ||
          !materials.some((m) => m.id === check.expectedMaterialId && m.path)
        )
          throw new Error(
            `${check.assertionId}: unchanged requires a named file and an existing material ID; generated fixture IDs do not exist`,
          );
        if (check.allowedPaths.some((path) => !path.startsWith("/")))
          throw new Error(
            `${check.assertionId}: allowedPaths are JSON pointers inside the compared document, not output filenames`,
          );
      } else if (check.value === undefined) {
        throw new Error(`${check.assertionId}: validator value is required`);
      }
      if (check.kind === "json_schema") {
        if (
          !check.file ||
          check.format !== "json" ||
          typeof check.value !== "string" ||
          check.value.length > 16000
        )
          throw new Error(
            `${check.assertionId}: json_schema requires a named JSON file and a JSON-encoded schema string of at most 16000 characters`,
          );
        JSON.parse(check.value);
      }
    }
  }
  return suite;
}
