import type { EvalConfig } from "../contracts/schema.js";

/** A new directory is not a read boundary: native agents can read sibling cases. */
export function assertBenchmarkIsolation(
  config: EvalConfig,
  enabled: boolean,
  workspaceDir = "",
): void {
  if (!enabled) return;
  if (config.environment.type !== "docker")
    throw new Error(
      "benchmark requires the verified isolated runtime (environment.type: docker); " +
      "native none workspaces do not restrict reads of other cases, Skills, or reports. " +
      "Disable benchmark for ordinary local evaluation, or configure a clean container image and --runtime docker. " +
      "OpenSandbox benchmarks require an equivalent verified grading boundary and are not enabled yet",
    );
  if (workspaceDir)
    throw new Error("benchmark cannot reuse an external workspace");
  if (config.engine.custom?.transport === "http")
    throw new Error(
      "benchmark requires an engine executing inside its case runtime; a custom HTTP engine executes outside that filesystem boundary",
    );
}
