import { posix } from "node:path";
import { z } from "zod";
import { parseDocument } from "yaml";
import {
  CoveragePlanSchema,
  TaskUnderstandingSchema,
  type GeneratedEvalCaseSchema,
  type JudgingArea,
} from "./contracts";
import { parseSkillMetadata } from "./intake";
import { sha256 } from "./artifacts";
import {
  validateResultMatrix,
  definitionsFromMapping,
  NORMALIZATION_VERSION,
} from "./grading";

export const EvaluationProfileSchema = z.object({
  schemaVersion: z.literal("skilled-profile-v1"),
  revision: z.number().int().positive(),
  task: TaskUnderstandingSchema,
  outputs: z.array(z.string()),
  areas: CoveragePlanSchema.shape.areas,
  approved: z.boolean(),
  hash: z.string(),
});
export type EvaluationProfile = z.infer<typeof EvaluationProfileSchema>;

export function validateInitialVerification(
  run: any,
  cases: any[],
  results: any[],
  adapter: string,
) {
  if (
    run.status !== "completed" ||
    run.iterations !== 3 ||
    run.provenance_status !== "verified_pipeline" ||
    run.engine_versions?.adapter !== adapter ||
    run.engine_versions?.normalizationVersion !== NORMALIZATION_VERSION
  )
    throw new Error(
      "Initial activation needs three completed trials from the current execution pipeline",
    );
  validateResultMatrix(
    results,
    cases.map((c) => c.case_id),
    Boolean(run.baseline),
    3,
  );
  for (const c of cases) {
    const definitions = definitionsFromMapping(c.assertion_mapping).filter(
      (a) => a.required,
    );
    if (!definitions.length)
      throw new Error("No required assertions available");
    for (const row of results.filter(
      (r) =>
        r.case_id === c.case_id &&
        ["skill", "with_skill"].includes(r.configuration),
    )) {
      if (row.result !== "PASS")
        throw new Error(
          "Every required check must pass before initial activation",
        );
      for (const definition of definitions) {
        const observed = (row.assertions ?? []).filter(
          (a: any) => a.id === definition.id,
        );
        if (
          observed.length !== 1 ||
          observed[0].passed !== true ||
          observed[0].error
        )
          throw new Error(
            "Initial verification has missing or invalid assertion evidence",
          );
      }
    }
  }
}
export type PackageFinding = {
  code: string;
  category: "validity" | "runtime" | "advice";
  severity: "blocker" | "advisory";
  message: string;
  path?: string;
  line?: number;
  action: string;
};
export type PackageAssessment = {
  schemaVersion: "skilled-package-assessment-v1";
  packageHash: string;
  provenance: "static-analysis";
  findings: PackageFinding[];
  references: { from: string; to: string; line: number; present: boolean }[];
  valid: boolean;
  inspectionComplete?: boolean;
  runtime: "not_checked" | "unsupported";
};

/** Analyze stored package bytes without running any uploaded instructions. */
export function assessPackage(input: {
  packageHash: string;
  name: string;
  selectedRoot?: string;
  entries: { path: string }[];
  texts: Record<string, string>;
  excluded?: string[];
}): PackageAssessment {
  const findings: PackageFinding[] = [];
  const references: PackageAssessment["references"] = [];
  const paths = new Set(input.entries.map((e) => e.path));
  try {
    const metadata = parseSkillMetadata(input.texts["SKILL.md"] ?? "");
    if (metadata.name !== input.name)
      throw new Error("Package identity differs from SKILL.md name");
    if (
      input.selectedRoot &&
      posix.basename(input.selectedRoot) !== metadata.name
    )
      throw new Error(
        "The selected Skill folder must match the name in SKILL.md",
      );
  } catch (error) {
    findings.push({
      code: "METADATA_INVALID",
      category: "validity",
      severity: "blocker",
      message: String(error),
      path: "SKILL.md",
      action: "Upload a version with valid Skill metadata.",
    });
  }
  for (const [from, text] of Object.entries(input.texts)) {
    if (!/\.md$/i.test(from)) continue;
    text.split(/\r?\n/).forEach((line, index) => {
      const targets = [
        ...line.matchAll(
          /\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)|`((?:scripts|references|assets)\/[^`]+)`/g,
        ),
      ].map((m) => m[1] ?? m[2]!);
      for (const raw of new Set(targets)) {
        if (references.length >= 2000) break;
        if (/^(?:[a-z]+:|#)/i.test(raw)) continue;
        let decoded: string;
        try {
          decoded = decodeURIComponent(raw.split(/[?#]/)[0]!);
        } catch {
          decoded = raw;
        }
        const to = posix.normalize(posix.join(posix.dirname(from), decoded));
        const unsafe =
          decoded.startsWith("/") ||
          to === ".." ||
          to.startsWith("../") ||
          to.includes("\\");
        const present =
          !unsafe &&
          (paths.has(to) || [...paths].some((p) => p.startsWith(`${to}/`)));
        references.push({ from, to, line: index + 1, present });
        if (!present)
          findings.push({
            code: unsafe ? "REFERENCE_ESCAPE" : "MISSING_REFERENCE",
            category: "validity",
            severity: "blocker",
            message: `Referenced resource is unavailable: ${to}`,
            path: from,
            line: index + 1,
            action:
              "Add the referenced resource or correct the instruction in a new version.",
          });
      }
    });
  }
  if ((input.texts["SKILL.md"] ?? "").split("\n").length > 500)
    findings.push({
      code: "LONG_INSTRUCTIONS",
      category: "advice",
      severity: "advisory",
      message: "Long instructions may benefit from referenced documents.",
      path: "SKILL.md",
      action:
        "Consider moving supporting detail into references; this does not block execution.",
    });
  for (const path of input.excluded ?? [])
    findings.push({
      code: "EXCLUDED_CONTROL",
      category: "advice",
      severity: "advisory",
      message: `Excluded from the tested package: ${path}`,
      path,
      action:
        "Keep orchestration configuration outside the Skill; inspect any references to this file.",
    });
  const codexMetadata = input.texts["agents/openai.yaml"] ?? "";
  let codexDependencies: any[] = [];
  if (codexMetadata) {
    const document = parseDocument(codexMetadata, { uniqueKeys: true });
    try {
      if (document.errors.length)
        throw new Error("Invalid optional Codex metadata");
      codexDependencies =
        document.toJS({ maxAliasCount: 20 })?.dependencies?.tools ?? [];
      if (!Array.isArray(codexDependencies))
        throw new Error("Expected a list of declared tools");
    } catch {
      findings.push({
        code: "CODEX_METADATA_INVALID",
        category: "runtime",
        severity: "blocker",
        message: "Optional Codex metadata cannot be parsed safely.",
        path: "agents/openai.yaml",
        action: "Correct the YAML before checking runtime compatibility.",
      });
    }
  }
  if (codexDependencies.some((tool) => tool?.type === "mcp"))
    findings.push({
      code: "UNSUPPORTED_MCP",
      category: "runtime",
      severity: "blocker",
      message:
        "This package declares a live MCP dependency, which this pilot cannot supply.",
      path: "agents/openai.yaml",
      action: "Provide an offline task variant or use a compatible runtime.",
    });
  const inspectionComplete =
    references.length < 2000 &&
    input.entries
      .filter((e) => /\.md$|^agents\/openai\.yaml$/i.test(e.path))
      .every((e) => Object.hasOwn(input.texts, e.path));
  if (!inspectionComplete)
    findings.push({
      code: "INSPECTION_LIMIT",
      category: "advice",
      severity: "advisory",
      message: "Some resources exceed the automatic inspection limits.",
      action:
        "Download and review uninspected resources before relying on this assessment.",
    });
  return {
    inspectionComplete,
    schemaVersion: "skilled-package-assessment-v1",
    packageHash: input.packageHash,
    provenance: "static-analysis",
    findings,
    references,
    valid: !findings.some(
      (f) => f.category === "validity" && f.severity === "blocker",
    ),
    runtime: findings.some((f) => f.category === "runtime")
      ? "unsupported"
      : "not_checked",
  };
}

export function profileHash(plan: unknown, understanding: unknown) {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, v]) => v !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, canonical(item)]),
          )
        : value;
  return sha256(JSON.stringify(canonical({ plan, understanding })));
}

export function validateCoverage(
  plan: z.infer<typeof CoveragePlanSchema>,
  cases?: z.infer<typeof GeneratedEvalCaseSchema>[],
) {
  const ids = new Set(plan.areas.map((a) => a.id));
  if (ids.size !== plan.areas.length)
    throw new Error("Duplicate judging area ID");
  if (plan.areas.some((a) => a.role === "informational" && a.required))
    throw new Error("Informational areas cannot be required");
  if (plan.groups.reduce((n, g) => n + g.caseCount, 0) > 50)
    throw new Error("Coverage exceeds the 50-case limit");
  if (!plan.areas.length) return; // Retained historical contracts.
  if (!plan.areas.some((a) => a.required && a.role === "task_success"))
    throw new Error("Define at least one required task-success area");
  if (plan.groups.some((g) => g.dimensions.some((d) => !ids.has(d))))
    throw new Error("Coverage references an unknown judging area");
  if (!cases) return;
  const groups = new Map(plan.groups.map((g) => [g.name, g]));
  if (
    groups.size !== plan.groups.length ||
    cases.some((c) => !groups.has(c.coverageGroup))
  )
    throw new Error("Unknown or duplicate coverage group");
  const assertionIds = new Set<string>();
  for (const item of cases) {
    if (!item.assertions.length)
      throw new Error(`${item.id}: task-specific assertions are required`);
    const usedAreas = new Set(item.assertions.map((a) => a.areaId));
    if (
      new Set(item.dimensions).size !== item.dimensions.length ||
      item.dimensions.length !== usedAreas.size ||
      item.dimensions.some((d) => !usedAreas.has(d))
    )
      throw new Error(
        `${item.id}: dimensions must match assertion areas exactly`,
      );
    for (const a of item.assertions) {
      const area = plan.areas.find((v) => v.id === a.areaId);
      if (
        !area ||
        a.role !== area.role ||
        (area.required && !a.required) ||
        assertionIds.has(a.id)
      )
        throw new Error(
          `${item.id}: invalid, duplicate or inconsistent assertion ${a.id}`,
        );
      assertionIds.add(a.id);
      if (
        item.judgeType === "script" &&
        !item.deterministicChecks.some((c) => c.assertionId === a.id)
      )
        throw new Error(`${a.id}: no explicit script validator`);
    }
    if (
      item.deterministicChecks.some(
        (c) => !item.assertions.some((a) => a.id === c.assertionId),
      )
    )
      throw new Error(`${item.id}: unmapped validator`);
  }
  for (const group of plan.groups) {
    const matching = cases.filter((c) => c.coverageGroup === group.name);
    if (matching.length !== group.caseCount)
      throw new Error(
        `Coverage count does not match approved group: ${group.name}`,
      );
    if (
      matching.some((c) =>
        c.dimensions.some((d) => !group.dimensions.includes(d)),
      )
    )
      throw new Error(`Case uses unapproved areas in group: ${group.name}`);
  }
  for (const area of plan.areas.filter((a) => a.required))
    if (
      !cases.some((c) =>
        c.assertions.some((a) => a.areaId === area.id && a.required),
      )
    )
      throw new Error(`Required area has no coverage: ${area.label}`);
}

export type AreaEvidence = {
  id: string;
  label: string;
  description: string;
  expected: number;
  pass: number;
  fail: number;
  error: number;
  missing: number;
};
export function summarizeAreaEvidence(
  areas: JudgingArea[],
  cases: any[],
  rows: any[],
  trials: number,
  variant = "skill",
  selectedTrial?: number,
): AreaEvidence[] {
  if (
    selectedTrial !== undefined &&
    (!Number.isInteger(selectedTrial) ||
      selectedTrial < 1 ||
      selectedTrial > trials)
  )
    throw new Error("Selected trial is outside the execution manifest");
  const allAreas = areas.length
    ? areas
    : [
        ...new Set<string>(cases.flatMap((c) => c.required_dimensions ?? [])),
      ].map((id) => ({
        id,
        label: id.replaceAll("_", " "),
        description: "Historical judging dimension",
        role: "constraint" as const,
        required: true,
        sourceReferences: [],
      }));
  return allAreas.map((area) => {
    const value: AreaEvidence = {
      id: area.id,
      label: area.label,
      description: area.description,
      expected: 0,
      pass: 0,
      fail: 0,
      error: 0,
      missing: 0,
    };
    for (const c of cases) {
      const defs = Object.values(c.assertion_mapping ?? {}).filter(
        (d: any) =>
          (d.areaId ?? d.dimension) === area.id && d.required !== false,
      ) as any[];
      for (let n = selectedTrial ?? 1; n <= (selectedTrial ?? trials); n++)
        for (const d of defs) {
          value.expected++;
          const samples = rows.filter(
            (r) =>
              r.case_id === c.case_id &&
              r.iteration === n &&
              (variant === "skill"
                ? ["skill", "with_skill"]
                : ["baseline", "without_skill"]
              ).includes(r.configuration),
          );
          if (!samples.length) {
            value.missing++;
            continue;
          }
          const observations = (samples[0].assertions ?? []).filter(
            (a: any) => a.id === d.id,
          );
          if (
            samples.length !== 1 ||
            samples[0].result === "ERROR" ||
            observations.length !== 1 ||
            observations[0].error ||
            typeof observations[0].passed !== "boolean"
          )
            value.error++;
          else if (observations[0].passed) value.pass++;
          else value.fail++;
        }
    }
    return value;
  });
}
