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
      approvedProfileHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable()
        .default(null),
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
  return assessExecutionEvidence(value, imageRevision).ready;
}

/** Safe diagnostics: never return arbitrary report details or filesystem paths. */
export function assessExecutionEvidence(
  value: unknown,
  imageRevision: string,
  now = Date.now(),
) {
  const parsed = ExecutionReadinessSchema.safeParse(value);
  if (!parsed.success)
    return {
      ready: false,
      code: "ACCEPTANCE_INVALID",
      detail:
        "Execution unavailable: the acceptance report has an invalid format. Regenerate it with the matching acceptance harness.",
    };
  const report = parsed.data;
  const checks = REQUIRED_EXECUTION_CHECKS.map((name) => {
    const matching = report.checks.filter((check) => check.name === name);
    return {
      name,
      status:
        matching.length === 0
          ? "missing"
          : matching.length > 1
            ? "duplicate"
            : matching[0]!.status,
    };
  });
  const timestamp = Date.parse(report.checkedAt);
  const expiry = new Date(timestamp + 24 * 60 * 60_000);
  const metadata = {
    checks,
    checkedAt: Number.isFinite(timestamp)
      ? new Date(timestamp).toISOString()
      : undefined,
    expiresAt: Number.isFinite(expiry.getTime()) ? expiry.toISOString() : null,
  };
  const blocked = (code: string, detail: string) => ({
    ...metadata,
    ready: false,
    code,
    detail: `Execution unavailable: ${detail}`,
  });
  if (report.imageRevision !== imageRevision)
    return blocked(
      "ACCEPTANCE_REVISION_MISMATCH",
      "the acceptance report belongs to another image. Rerun acceptance on the image being deployed.",
    );
  const age = now - Date.parse(report.checkedAt);
  if (!Number.isFinite(age) || age < 0)
    return blocked(
      "ACCEPTANCE_TIME_INVALID",
      "the acceptance timestamp is invalid or in the future. Check the executor clock and rerun acceptance.",
    );
  if (age >= 24 * 60 * 60_000)
    return blocked(
      "ACCEPTANCE_EXPIRED",
      "the acceptance report is older than 24 hours. Rerun the checks; retrying generation or extending the report timestamp cannot renew acceptance.",
    );
  if (
    report.status !== "ready" ||
    checks.some((check) => check.status !== "passed")
  )
    return blocked(
      "ISOLATION_NOT_ACCEPTED",
      "isolation acceptance has failed, pending, missing or duplicate checks. Complete every required check on this executor. The preliminary canary alone cannot enable real execution.",
    );
  return {
    ...metadata,
    ready: true,
    code: "ISOLATION_ACCEPTED",
    detail: "Isolation acceptance is current for this image.",
  };
}
