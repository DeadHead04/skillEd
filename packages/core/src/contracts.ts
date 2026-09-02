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
export const MaterialQuestionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  prompt: z.string().min(1),
  whyItMatters: z.string().min(1),
  required: z.boolean().default(true),
  answerType: z.enum(["text", "choice"]).default("text"),
  choices: z.array(z.string()).default([]),
});
export const AuthoringIntakeSchema = z.object({
  understanding: TaskUnderstandingSchema,
  questions: z.array(MaterialQuestionSchema),
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
export const GeneratedEvalCaseSchema = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9_-]{2,63}$/),
  title: z.string().min(1),
  coverageGroup: z.string().min(1),
  purpose: z.string().min(1),
  prompt: z.string().min(1),
  judgeType: z.enum(["agent", "script"]).default("agent"),
  dimensions: z.array(DimensionSchema).min(1),
  provenance: z.array(z.string()).min(1),
  criteria: z.array(z.string().min(1)).min(1),
  deterministicChecks: z
    .array(
      z.object({
        kind: z.enum(["equals", "contains", "not_contains"]),
        value: z.string().min(1),
      }),
    )
    .max(20),
});
export const GeneratedEvalSuiteSchema = z.object({
  cases: z.array(GeneratedEvalCaseSchema).min(1).max(50),
  generationNotes: z.array(z.string()).default([]),
});
export const ConversationReplySchema = z.object({
  reply: z.string().min(1),
});
export const SkillFileChangeSchema = z.object({
  path: z
    .string()
    .min(1)
    .refine(
      (value) =>
        !value.startsWith("/") &&
        !value.startsWith("\\") &&
        !/(^|[\\/])\.\.([\\/]|$)/.test(value),
      "Skill change path must remain inside the Skill root",
    ),
  action: z.enum(["replace", "create"]),
  content: z.string().max(1_000_000),
  reason: z.string().min(1),
});
export const EvalCaseChangeSchema = z.object({
  caseId: z.string().min(1),
  reason: z.string().min(1),
  prompt: z.string().min(1).nullable(),
  criteria: z.array(z.string().min(1)).min(1).nullable(),
});
export const UpdateProposalOutputSchema = z.object({
  rootCause: z.string().min(1),
  intendedEffect: z.string().min(1),
  verification: z.string().min(1),
  risks: z.array(z.string()),
  skillChanges: z.array(SkillFileChangeSchema).min(1),
  evalChanges: z.array(EvalCaseChangeSchema).default([]),
});

export const EvalAnswersSchema = z.object({
  answers: z.record(z.string(), z.string().min(1)),
});
export const ConversationMessageSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
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
