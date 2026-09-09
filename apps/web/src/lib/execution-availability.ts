export function executionAvailability(
  worker:
    | { last_seen_at: string | Date; readiness?: Record<string, any> }
    | undefined,
  mode = process.env.SKILLED_ADAPTER_MODE,
  now = Date.now(),
) {
  const age = worker ? now - new Date(worker.last_seen_at).getTime() : Infinity;
  if (!Number.isFinite(age) || age < 0 || age >= 30_000)
    return {
      available: false,
      code: "WORKER_UNAVAILABLE",
      detail:
        "Execution unavailable: the worker is missing or its heartbeat is stale. An administrator must check the worker connection. Your draft is preserved.",
    };
  const expected = mode === "fake" ? "demo" : "ready";
  const actual = worker?.readiness?.execution;
  if (actual === expected)
    return {
      available: true,
      code: expected === "demo" ? "DEMO" : "READY",
      detail:
        expected === "demo"
          ? "Demo evidence: no real model calls."
          : "Execution ready.",
    };
  if (actual === "ready" || actual === "demo")
    return {
      available: false,
      code: "ADAPTER_MISMATCH",
      detail:
        "Execution unavailable: the web and worker adapter modes do not match. Configure both services for the same intended mode.",
    };
  return {
    available: false,
    code: String(worker?.readiness?.code ?? "EXECUTION_UNAVAILABLE"),
    detail: String(
      worker?.readiness?.detail ??
        "Execution unavailable: the executor has not passed isolation and login acceptance. An administrator must check Diagnostics. Your draft is preserved.",
    ),
  };
}
