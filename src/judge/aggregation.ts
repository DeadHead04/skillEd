// Modified for the skilled TypeScript distribution.
import {
  newResult,
  type Outcome,
  type Result,
  type Status,
  type AssertionResult,
} from "./types.js";
export interface OutcomeAggregator {
  strategy(): string;
  aggregate(
    outcomes: Outcome[],
    turnsExecuted: number,
    turnsTotal: number,
  ): { result: Result; status: Status };
}
export class AllRequiredAggregator implements OutcomeAggregator {
  strategy(): string {
    return "all_required";
  }
  aggregate(
    outcomes: Outcome[],
    turnsExecuted: number,
    turnsTotal: number,
  ): { result: Result; status: Status } {
    const assertions: AssertionResult[] = [];
    let status: Status = "PASS";
    for (const outcome of outcomes) {
      const evidence = [
        outcome.error,
        outcome.skip_reason,
        ...(outcome.result?.assertion_results ?? [])
          .filter((a) => !a.passed && a.evidence)
          .map((a) => a.evidence),
      ].filter(Boolean);
      assertions.push({
        text: `judge ${outcome.id} (${outcome.type})`,
        passed: outcome.status === "PASS",
        evidence: outcome.status + ": " + evidence.join("; "),
      });
      if (outcome.status === "ERROR" || outcome.status === "SKIP")
        status = "ERROR";
      else if (outcome.status === "FAIL" && status !== "ERROR") status = "FAIL";
    }
    const result = newResult(assertions, turnsExecuted, turnsTotal);
    result.status = status;
    return { result, status };
  }
}
export const defaultOutcomeAggregator = (): OutcomeAggregator =>
  new AllRequiredAggregator();
