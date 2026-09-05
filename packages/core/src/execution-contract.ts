import { z } from "zod";
export const ExecutionManifestSchema = z.object({
  schemaVersion: z
    .literal("skilled-execution-v1")
    .default("skilled-execution-v1"),
  executionId: z.uuid(),
  jobId: z.uuid(),
  leaseToken: z.number().int().positive(),
  resourceId: z.uuid(),
  adapter: z.enum(["real", "demo"]),
  inputKey: z.string(),
  inputChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  inputGrant: z.string(),
  operation: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("appServer"),
      prompt: z.string().max(500_000),
      outputSchema: z.unknown(),
      threadId: z.string().optional(),
      recoveryContext: z.string().optional(),
      skillPath: z.string().optional(),
    }),
    z.object({
      kind: z.literal("skillup"),
      evalPath: z.string(),
      model: z.string(),
      iterations: z.number().int().min(1).max(3),
      baseline: z.boolean(),
      selectedCaseIds: z
        .array(z.string().regex(/^[A-Za-z0-9_-]+$/))
        .min(1)
        .max(50),
    }),
  ]),
});
export type ExecutionManifest = z.infer<typeof ExecutionManifestSchema>;
export const ArtifactManifestSchema = z.object({
  schemaVersion: z.literal("skilled-artifacts-v1"),
  entries: z.array(
    z.object({
      key: z.string(),
      checksum: z.string(),
      size: z.number().int().nonnegative(),
      mediaType: z.string(),
    }),
  ),
});
export type ArtifactManifest = z.infer<typeof ArtifactManifestSchema>;
export const ExecutionReadinessSchema = z.object({
  schemaVersion: z.literal("skilled-readiness-v1"),
  status: z.enum(["ready", "blocked"]),
  checkedAt: z.string(),
  imageRevision: z.string(),
  checks: z.array(
    z.object({
      name: z.string(),
      status: z.enum(["passed", "failed", "pending"]),
      detail: z.string(),
    }),
  ),
});
export type ExecutionReadiness = z.infer<typeof ExecutionReadinessSchema>;
export const REQUIRED_EXECUTION_CHECKS = [
  "non_root",
  "workspace",
  "hidden_reads",
  "process_isolation",
  "network_denial",
  "script_judge",
  "resource_limits",
  "codex_initial",
  "codex_resume",
  "app_server",
  "judge_correction",
  "login_persistence",
  "conversation_recovery",
];
export function acceptsExecutionEvidence(
  value: unknown,
  imageRevision: string,
) {
  const parsed = ExecutionReadinessSchema.safeParse(value);
  if (!parsed.success) return false;
  const report = parsed.data;
  const age = Date.now() - Date.parse(report.checkedAt);
  return (
    report.status === "ready" &&
    report.imageRevision === imageRevision &&
    age >= 0 &&
    age < 24 * 60 * 60_000 &&
    REQUIRED_EXECUTION_CHECKS.every(
      (name) =>
        report.checks.filter((c) => c.name === name).length === 1 &&
        report.checks.find((c) => c.name === name)?.status === "passed",
    )
  );
}
