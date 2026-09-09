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

export const RunProgressConfigurationSchema = z.enum([
  "with_skill",
  "without_skill",
  "unknown",
]);
export const RunProgressStatusSchema = z.enum([
  "PASS",
  "FAIL",
  "ERROR",
  "SKIP",
]);
export const CaseStartedProgressSchema = z.object({
  caseId: z.string(),
  index: z.number().int().positive(),
  total: z.number().int().positive(),
  configuration: RunProgressConfigurationSchema,
  iteration: z.number().int().positive(),
  provisional: z.literal(true),
});
export const CaseCompletedProgressSchema = CaseStartedProgressSchema.extend({
  reportedStatus: RunProgressStatusSchema,
});
export const StageChangedProgressSchema = z.object({
  stage: z.string().min(1),
});
export type RunProgressConfiguration = z.infer<
  typeof RunProgressConfigurationSchema
>;
export type RunProgressStatus = z.infer<typeof RunProgressStatusSchema>;
export type CaseStartedProgress = z.infer<typeof CaseStartedProgressSchema>;
export type CaseCompletedProgress = z.infer<typeof CaseCompletedProgressSchema>;

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
export const MaterialKindSchema = z.enum([
  "task",
  "dataset",
  "authority",
  "expected",
  "example",
  "past_failure",
]);
export type Result = z.infer<typeof ResultSchema>;
export const LegacyDimensionSchema = z.enum([
  "correctness",
  "semantic",
  "source",
  "scope",
  "artifact",
  "stability",
]);
// New evaluations name their own areas. The six historical names remain valid.
export const DimensionSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const OutcomeRoleSchema = z.enum([
  "task_success",
  "constraint",
  "informational",
]);
export const JudgingAreaSchema = z.object({
  id: DimensionSchema,
  label: z.string().min(1).max(80),
  description: z.string().min(1).max(400),
  role: OutcomeRoleSchema,
  required: z.boolean(),
  sourceReferences: z.array(
    z.object({ materialId: z.uuid(), location: z.string().min(1).max(500) }),
  ),
});
export type JudgingArea = z.infer<typeof JudgingAreaSchema>;
export const TaskAssertionSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  areaId: DimensionSchema,
  text: z.string().min(1),
  role: OutcomeRoleSchema,
  required: z.boolean(),
});

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
  areas: z.array(JudgingAreaSchema).max(24).default([]),
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
  assertions: z.array(TaskAssertionSchema).max(50).default([]),
  id: z.string().regex(/^[A-Z][A-Z0-9_-]{2,63}$/),
  title: z.string().min(1),
  coverageGroup: z.string().min(1),
  purpose: z.string().min(1),
  prompt: z.string().min(1),
  judgeType: z.enum(["agent", "script"]).default("agent"),
  dimensions: z.array(DimensionSchema).min(1),
  provenance: z.array(z.string()).min(1),
  sourceReferences: z
    .array(
      z.object({ materialId: z.uuid(), location: z.string().min(1).max(500) }),
    )
    .default([]),
  criteria: z.array(z.string().min(1)).min(1),
  deterministicChecks: z
    .array(
      z.object({
        assertionId: z.string().optional(),
        kind: z.enum(["equals", "contains", "not_contains", "unchanged"]),
        value: z
          .union([z.string(), z.number(), z.boolean(), z.null()])
          .optional(),
        dimension: DimensionSchema.default("correctness"),
        file: z.string().optional(),
        format: z.enum(["text", "json", "csv", "xlsx"]).default("text"),
        selector: z.string().default(""),
        expectedMaterialId: z.string().optional(),
        allowedPaths: z.array(z.string()).default([]),
      }),
    )
    .max(20),
});
export const GeneratedEvalSuiteSchema = z.object({
  cases: z.array(GeneratedEvalCaseSchema).min(1).max(50),
  generationNotes: z.array(z.string()).default([]),
});
export const AuthoringRevisionSchema = z.object({
  reply: z.string().min(1),
  revision: z
    .object({
      understanding: TaskUnderstandingSchema,
      plan: CoveragePlanSchema,
    })
    .nullable(),
});
export const ConversationReplySchema = z.object({
  reply: z.string().min(1),
});
export const LoginIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, {
    message:
      "Use 3-40 lowercase letters, numbers, periods, underscores, or hyphens.",
  });
export const PasswordSchema = z.string().min(12).max(128);
export const UserRoleSchema = z.enum(["administrator", "operator"]);
export const LoginSchema = z.object({
  loginId: LoginIdSchema,
  password: z.string().min(1).max(128),
});
export const CreateUserSchema = z.object({
  loginId: LoginIdSchema,
  displayName: z.string().trim().min(1).max(80),
  role: UserRoleSchema,
  password: PasswordSchema,
});
export const UpdateUserSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    role: UserRoleSchema.optional(),
    active: z.boolean().optional(),
    password: PasswordSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one user field must change.",
  });
export const SkillFileChangeSchema = z.object({
  targetAssertionIds: z.array(z.string().min(1).max(128)).max(1000).default([]),
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
  action: z.enum(["replace", "create", "delete", "rename"]),
  content: z.string().max(1_000_000).optional(),
  from: z.string().optional(),
  reason: z.string().min(1),
});
export const EvalCaseChangeSchema = z.object({
  caseId: z.string().min(1),
  deterministicChecks: GeneratedEvalCaseSchema.shape.deterministicChecks
    .nullable()
    .default(null),
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
  model: z.string().default("gpt-5.6-luna"),
  iterations: z.number().int().min(1).max(3).default(1),
  baseline: z.boolean().default(false),
  selectedCaseIds: z
    .array(z.string().regex(/^[A-Z][A-Z0-9_-]{2,63}$/))
    .min(1)
    .max(50)
    .optional(),
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
