// Modified for the skilled TypeScript distribution.
import type { Result, ContextMetadata } from "../judge/types.js";
import { writeJSONFile } from "./helpers.js";
export interface AnthropicGrading {
  expectations: AnthropicExpectation[] | null;
  summary: AnthropicSummary;
  judge_context?: ContextMetadata | null;
}
export interface AnthropicExpectation {
  text: string;
  passed: boolean;
  evidence: string;
}
export interface AnthropicSummary {
  passed: number;
  failed: number;
  total: number;
  pass_rate: number;
}
export interface EvalMetadata {
  eval_id: number;
  eval_name: string;
  prompt: string;
  assertions: string[] | null;
}
export function convertToAnthropicGrading(
  result: Result | null,
): AnthropicGrading {
  return {
    expectations: (result?.assertion_results ?? []).map((a) => ({
      text: a.text,
      passed: a.passed,
      evidence: a.evidence,
    })),
    summary: result
      ? { ...result.summary }
      : { passed: 0, failed: 0, total: 0, pass_rate: 0 },
    ...(result?.judge_context ? { judge_context: result.judge_context } : {}),
  };
}
export const writeGradingJSON = (
  path: string,
  grading: AnthropicGrading | null,
) => writeJSONFile(path, grading, "grading json");
export const writeEvalMetadata = (path: string, meta: EvalMetadata | null) =>
  writeJSONFile(path, meta, "eval metadata");
