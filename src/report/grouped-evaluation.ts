// Modified for the skilled TypeScript distribution.
import type { ExpectResult, Outcome, Status } from "../judge/types.js";
export interface GroupedEvaluation {
  version: number;
  gates?: ExpectResult | null;
  judge_results: Outcome[] | null;
  aggregation: GroupAggregation;
}
export interface GroupAggregation {
  strategy: string;
  status: Status;
}
