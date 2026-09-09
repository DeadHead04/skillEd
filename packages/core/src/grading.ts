import { z } from "zod";
import { DimensionSchema, ResultSchema, OutcomeRoleSchema } from "./contracts";
import { deriveResult, worstResult } from "./results";

export const NORMALIZATION_VERSION = "skilled-grading-v3";
export const AssertionDefinitionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  dimension: DimensionSchema,
  areaId: DimensionSchema.optional(),
  role: OutcomeRoleSchema.optional(),
  required: z.boolean().default(true),
});
export type AssertionDefinition = z.infer<typeof AssertionDefinitionSchema>;
export const GradingEnvelopeSchema = z.object({
  schemaVersion: z.literal("skilled-grading-v1"),
  assertions: z.array(
    z.object({
      id: z.string().min(1),
      passed: z.boolean(),
      evidence: z.string().min(1),
      observations: z
        .array(
          z.object({
            file: z.string(),
            selector: z.string(),
            protected: z.boolean().optional(),
            format: z.string().optional(),
            allowedPaths: z.array(z.string()).optional(),
            expected: z.unknown(),
            actual: z.unknown(),
          }),
        )
        .optional(),
    }),
  ),
  error: z.object({ code: z.string(), detail: z.string() }).nullable(),
});
export type GradingEnvelope = z.infer<typeof GradingEnvelopeSchema>;
export type GradedAssertion = AssertionDefinition & {
  passed: boolean;
  evidence: string;
  error?: string;
};
export const configuration = (value: unknown): "skill" | "baseline" => {
  if (value === "skill" || value === "with_skill") return "skill";
  if (value === "baseline" || value === "without_skill") return "baseline";
  throw new Error(`Unknown result configuration: ${String(value)}`);
};

export function definitionsFromMapping(
  mapping: Record<string, any>,
): AssertionDefinition[] {
  return Object.entries(mapping ?? {}).map(([text, meta]) =>
    AssertionDefinitionSchema.parse({
      id: meta.id ?? text,
      text,
      dimension: meta.areaId ?? meta.dimension,
      areaId: meta.areaId,
      role: meta.role,
      required: meta.required !== false,
    }),
  );
}

/** Raw backend results remain available; normalization never invents missing evidence. */
export function normalizeGrading(
  raw: Record<string, any>,
  definitions: AssertionDefinition[],
  judge: string,
  requiredDimensions: string[] = [],
) {
  let assertions: GradedAssertion[] = [];
  let errorClass: string | null = null;
  let detail = "";
  try {
    if (!definitions.length || !definitions.some((a) => a.required))
      throw new Error("No required assertions defined");
    if (
      requiredDimensions.some(
        (dimension) =>
          !definitions.some((a) => a.required && a.dimension === dimension),
      )
    )
      throw new Error("Required dimension has no assertion definition");
    if (new Set(definitions.map((a) => a.id)).size !== definitions.length)
      throw new Error("Duplicate assertion definition");
    if (!["PASS", "FAIL", "ERROR"].includes(raw.status))
      throw new Error("Invalid backend status");
    if (raw.status === "ERROR") {
      errorClass = "agent_or_judge_execution";
      throw new Error(String(raw.error ?? "Backend execution failed"));
    }
    const source = raw.grading?.assertion_results;
    if (!Array.isArray(source) || !source.length)
      throw new Error("Missing grading assertions");
    let actual: Array<{ id: string; passed: boolean; evidence: string }>;
    if (judge === "script") {
      if (source.length !== 1 || typeof source[0].evidence !== "string")
        throw new Error("Invalid script grading result");
      const evidence = source[0].evidence;
      // The harness emits one JSON line. Skill-Up may append stderr after it.
      const lines = evidence
        .split("\n")
        .filter((s: string) =>
          s.startsWith('{"schemaVersion":"skilled-grading-v1"'),
        );
      if (lines.length !== 1) {
        errorClass = "judge_execution";
        throw new Error("Script must emit exactly one grading envelope");
      }
      const envelope = GradingEnvelopeSchema.parse(JSON.parse(lines[0]!));
      if (envelope.error) {
        errorClass = "judge_execution";
        throw new Error(`${envelope.error.code}: ${envelope.error.detail}`);
      }
      actual = envelope.assertions;
    } else {
      actual = source.map((a) => {
        if (typeof a.text !== "string" || typeof a.passed !== "boolean")
          throw new Error("Malformed assertion");
        const definition = definitions.find(
          (d) => d.text === a.text || d.id === a.text,
        );
        if (!definition) throw new Error(`Unmapped assertion: ${a.text}`);
        return {
          id: definition.id,
          passed: a.passed,
          evidence:
            typeof a.evidence === "string" && a.evidence.trim()
              ? a.evidence
              : (() => {
                  throw new Error("Assertion evidence is empty");
                })(),
        };
      });
    }
    const seen = new Set<string>();
    for (const a of actual) {
      if (seen.has(a.id)) throw new Error(`Duplicate assertion: ${a.id}`);
      seen.add(a.id);
      const definition = definitions.find((d) => d.id === a.id);
      if (!definition) throw new Error(`Unknown assertion: ${a.id}`);
      assertions.push({ ...definition, ...a });
    }
    for (const definition of definitions)
      if (definition.required && !seen.has(definition.id))
        throw new Error(`Missing required assertion: ${definition.id}`);
    const derived = deriveResult(assertions);
    if (
      (raw.status === "PASS" && derived !== "PASS") ||
      (raw.status === "FAIL" &&
        derived === "PASS" &&
        !assertions.some((a) => !a.required && !a.passed))
    )
      throw new Error("Backend status contradicts assertion evidence");
  } catch (cause) {
    errorClass ??= "invalid_grading";
    detail = cause instanceof Error ? cause.message : String(cause);
    assertions.push({
      id: "ingestion-error",
      text: "Evidence validation",
      dimension: "stability",
      required: true,
      passed: false,
      evidence: detail,
      error: detail,
    });
  }
  const dimensions = Object.fromEntries(
    [...new Set(assertions.map((a) => a.dimension))].map((dimension) => [
      dimension,
      assertions
        .filter((a) => a.dimension === dimension && a.required)
        .every((a) => a.passed && !a.error),
    ]),
  );
  return {
    result: deriveResult(assertions),
    assertions,
    dimensions,
    errorClass,
    detail,
  };
}

export function validateResultMatrix(
  rows: Array<Record<string, any>>,
  caseIds: string[],
  baseline: boolean,
  iterations: number,
) {
  if (!caseIds.length || new Set(caseIds).size !== caseIds.length)
    throw new Error("Empty or duplicate expected cases");
  if (!Number.isInteger(iterations) || iterations < 1)
    throw new Error("Invalid expected iterations");
  const expected = new Set<string>();
  for (const id of caseIds)
    for (const config of baseline ? ["skill", "baseline"] : ["skill"])
      for (let n = 1; n <= iterations; n++)
        expected.add(`${id}:${config}:${n}`);
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.case_id}:${configuration(row.configuration)}:${row.iteration}`;
    if (!expected.has(key) || seen.has(key))
      throw new Error(`Unexpected or duplicate execution sample: ${key}`);
    seen.add(key);
  }
  if (seen.size !== expected.size)
    throw new Error(`Incomplete report: ${seen.size}/${expected.size} samples`);
}

export function compareVerification(
  before: Array<Record<string, any>>,
  after: Array<Record<string, any>>,
  caseIds: string[],
  iterations: number,
  baseline = false,
) {
  const reasons: string[] = [];
  try {
    validateResultMatrix(before, caseIds, baseline, iterations);
    validateResultMatrix(after, caseIds, baseline, iterations);
  } catch (error) {
    reasons.push(String(error));
  }
  const cases = caseIds.map((caseId) => {
    const old = before.filter(
      (r) => r.case_id === caseId && configuration(r.configuration) === "skill",
    );
    const next = after.filter(
      (r) => r.case_id === caseId && configuration(r.configuration) === "skill",
    );
    const current = worstResult(old.map((r) => ResultSchema.parse(r.result)));
    const candidate = worstResult(
      next.map((r) => ResultSchema.parse(r.result)),
    );
    let regressed = false;
    let flaky = false;
    for (const config of baseline ? ["skill", "baseline"] : ["skill"]) {
      const prior = before.filter(
        (r) =>
          r.case_id === caseId && configuration(r.configuration) === config,
      );
      const subsequent = after.filter(
        (r) =>
          r.case_id === caseId && configuration(r.configuration) === config,
      );
      const ids = new Set(
        prior.flatMap((r) =>
          (r.assertions ?? [])
            .filter((a: any) => a.required !== false)
            .map((a: any) => a.id),
        ),
      );
      if (
        !ids.size ||
        prior.some((r) => r.result === "ERROR") ||
        subsequent.some((r) => r.result === "ERROR")
      )
        reasons.push(`${caseId}: untrustworthy verification evidence`);
      for (const id of ids) {
        const values = (rows: Record<string, any>[]) =>
          rows.map((r) => r.assertions?.find((a: any) => a.id === id)?.passed);
        const a = values(prior),
          b = values(subsequent);
        if ([...a, ...b].some((v) => typeof v !== "boolean"))
          reasons.push(`${caseId}: missing assertion ${id}`);
        if (
          b.filter((v) => v === false).length >
          a.filter((v) => v === false).length
        )
          regressed = true;
        if (new Set(b).size > 1) flaky = true;
      }
    }
    if (regressed || flaky || candidate === "ERROR")
      reasons.push(`${caseId}: regression, instability, or error`);
    // Failures from the source comparison are the conservative initial target set.
    if (current !== "PASS" && candidate !== "PASS")
      reasons.push(`${caseId}: targeted failure remains`);
    return {
      caseId,
      current,
      candidate,
      category: regressed
        ? "Regressed"
        : flaky
          ? "Flaky"
          : current !== "PASS" && candidate === "PASS"
            ? "Fixed"
            : "Unchanged",
    };
  });
  return { cases, blocked: reasons.length > 0, reasons };
}
