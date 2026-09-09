import type { Result } from "./contracts";

export type Assertion = {
  dimension?: string;
  role?: "task_success" | "constraint" | "informational";
  required?: boolean;
  passed?: boolean;
  error?: string;
};
export function deriveResult(assertions: Assertion[]): Result {
  if (!assertions.length || !assertions.some((a) => a.required !== false))
    return "ERROR";
  if (
    assertions.some(
      (a) => a.error || !a.dimension || typeof a.passed !== "boolean",
    )
  )
    return "ERROR";
  const failed = assertions.filter(
    (a) => a.required !== false && a.passed === false,
  );
  if (
    failed.some(
      (a) =>
        a.role === "task_success" || (!a.role && a.dimension === "correctness"),
    )
  )
    return "FAIL";
  if (failed.length) return "PARTIAL";
  return "PASS";
}
const severity: Record<Result, number> = {
  PASS: 0,
  PARTIAL: 1,
  FAIL: 2,
  ERROR: 3,
};
export function worstResult(results: Result[]) {
  if (!results.length) return "ERROR";
  return results.reduce<Result>(
    (worst, value) => (severity[value] > severity[worst] ? value : worst),
    "PASS",
  );
}
export function compareResults(current: Result[], candidate: Result[]) {
  if (new Set(current).size > 1 || new Set(candidate).size > 1)
    return "Flaky" as const;
  const before = severity[worstResult(current)],
    after = severity[worstResult(candidate)];
  if (after < before) return "Fixed" as const;
  if (after > before) return "Regressed" as const;
  return "Unchanged" as const;
}
