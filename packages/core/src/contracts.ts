import { z } from "zod";

export const jobEventTypes = [
  "stage_changed",
  "conversation_delta",
  "message_completed",
  "case_started",
  "case_completed",
  "artifact_created",
  "warning",
  "completed",
  "failed",
] as const;
export const JobEventSchema = z.object({
  id: z.number().int(),
  jobId: z.uuid(),
  type: z.enum(jobEventTypes),
  occurredAt: z.iso.datetime(),
  data: z.unknown(),
});
export type JobEvent = z.infer<typeof JobEventSchema>;

export const ProblemSchema = z.object({
  code: z.string(),
  title: z.string(),
  detail: z.string(),
  field: z.string().optional(),
  retryable: z.boolean(),
  correlationId: z.string(),
});
export type Problem = z.infer<typeof ProblemSchema>;

export const EvidenceLevelSchema = z.enum([
  "Provisional",
  "Behavioral",
  "Grounded",
  "Strong",
]);
export const ResultSchema = z.enum(["ERROR", "FAIL", "PARTIAL", "PASS"]);
export type Result = z.infer<typeof ResultSchema>;
export const DimensionSchema = z.enum([
  "correctness",
  "semantic",
  "source",
  "scope",
  "artifact",
  "stability",
]);

export const TaskUnderstandingSchema = z.object({
  inputs: z.array(z.string()),
  outputs: z.array(z.string()),
  authorities: z.array(z.string()),
  invariants: z.array(z.string()),
  allowedChanges: z.array(z.string()),
  dependencies: z.array(z.string()),
  ambiguity: z.array(z.string()),
  likelyHallucinations: z.array(z.string()),
  failureModes: z.array(z.string()),
});
export const CoveragePlanSchema = z.object({
  groups: z.array(
    z.object({
      name: z.string(),
      purpose: z.string(),
      caseCount: z.number().int().positive(),
      judge: z.enum(["rule", "script", "agent"]),
      dimensions: z.array(DimensionSchema),
      provenance: z.array(z.string()),
      iterations: z.number().int().positive(),
    }),
  ),
});

export const RunLaunchSchema = z.object({
  skillVersionId: z.uuid(),
  evalVersionId: z.uuid(),
  model: z.string().default("gpt-5.4"),
  iterations: z.number().int().min(1).max(3).default(1),
  baseline: z.boolean().default(false),
});
export const ProposalDecisionSchema = z.object({
  skillDecision: z.enum(["approved", "rejected"]),
  evalDecision: z.enum(["approved", "rejected"]),
});

export function problem(
  code: string,
  title: string,
  detail: string,
  retryable = false,
  field?: string,
): Problem {
  return {
    code,
    title,
    detail,
    retryable,
    field,
    correlationId: crypto.randomUUID(),
  };
}

export function evidenceLevel(kinds: string[], hasFailures = false) {
  hasFailures ||= kinds.includes("past_failure");
  const grounded = kinds.some((k) => k === "expected" || k === "authority");
  const behavioral = kinds.some((k) => k === "task" || k === "example");
  const dataset = kinds.some((k) => k === "dataset");
  if (grounded && (dataset || hasFailures)) return "Strong" as const;
  if (grounded) return "Grounded" as const;
  if (behavioral) return "Behavioral" as const;
  return "Provisional" as const;
}
