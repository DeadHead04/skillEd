// Modified for the skilled TypeScript distribution.
import { mean, stdDev } from "./benchmark.js";
import type { AnthropicExpectation } from "./grading.js";
import { writeJSONFile } from "./helpers.js";
import { rfc3339 } from "./reporter.js";
export interface AnthropicBenchmark {
  metadata: BenchmarkMetadata;
  runs: BenchmarkRun[] | null;
  run_summary: AnthropicRunSummary;
  notes?: string[] | null;
}
export interface BenchmarkMetadata {
  skill_name: string;
  skill_path: string;
  timestamp: string;
  evals_run: number[] | null;
  runs_per_configuration: number;
}
export interface BenchmarkRun {
  eval_id: number;
  eval_name: string;
  configuration: string;
  run_number: number;
  result: BenchmarkRunResult;
  expectations: AnthropicExpectation[] | null;
}
export interface BenchmarkRunResult {
  pass_rate: number;
  passed: number;
  failed: number;
  total: number;
  time_seconds: number;
  tokens: number;
  errors: number;
}
export interface AnthropicRunSummary {
  with_skill: AnthropicStatSummary;
  without_skill: AnthropicStatSummary | null;
  delta: AnthropicDelta | null;
}
export interface AnthropicStatSummary {
  pass_rate: AnthropicStatValue;
  time_seconds: AnthropicStatValue;
  tokens: AnthropicStatValue;
}
export interface AnthropicStatValue {
  mean: number;
  stddev: number;
  min: number;
  max: number;
}
export interface AnthropicDelta {
  pass_rate: string;
  time_seconds: string;
  tokens: string;
}
import { fixed } from "./helpers.js";
export const sliceMin = (values: number[]): number =>
  values.reduce((min, v) => (v < min ? v : min), values[0] ?? 0);
export const sliceMax = (values: number[]): number =>
  values.reduce((max, v) => (v > max ? v : max), values[0] ?? 0);
export function computeAnthropicStatValue(
  values: number[],
): AnthropicStatValue {
  return {
    mean: mean(values),
    stddev: stdDev(values),
    min: sliceMin(values),
    max: sliceMax(values),
  };
}
export const extractRunMetric = (
  runs: BenchmarkRun[] | null,
  fn: (run: BenchmarkRun) => number,
): number[] => (runs ?? []).map(fn);
export function computeAnthropicRunSummary(
  runs: BenchmarkRun[] | null,
): AnthropicStatSummary {
  return {
    pass_rate: computeAnthropicStatValue(
      extractRunMetric(runs, (r) => r.result.pass_rate),
    ),
    time_seconds: computeAnthropicStatValue(
      extractRunMetric(runs, (r) => r.result.time_seconds),
    ),
    tokens: computeAnthropicStatValue(
      extractRunMetric(runs, (r) => r.result.tokens),
    ),
  };
}
export interface BenchmarkOptions {
  timestamp: string | Date;
}
export const withTimestamp =
  (timestamp: string | Date) =>
  (options: BenchmarkOptions): void => {
    options.timestamp = timestamp;
  };
export function computeAnthropicBenchmark(
  skillName: string,
  skillPath: string,
  withSkillRuns: BenchmarkRun[] | null,
  withoutSkillRuns: BenchmarkRun[] | null,
  ...options: ((options: BenchmarkOptions) => void)[]
): AnthropicBenchmark {
  const opts: BenchmarkOptions = { timestamp: new Date() };
  for (const option of options) option(opts);
  const runs = [...(withSkillRuns ?? []), ...(withoutSkillRuns ?? [])],
    withSkill = computeAnthropicRunSummary(withSkillRuns);
  const result: AnthropicBenchmark = {
    metadata: {
      skill_name: skillName,
      skill_path: skillPath,
      timestamp: rfc3339(opts.timestamp),
      evals_run: [...new Set(runs.map((r) => r.eval_id))].sort((a, b) => a - b),
      runs_per_configuration: 1,
    },
    runs,
    run_summary: { with_skill: withSkill, without_skill: null, delta: null },
  };
  if (withoutSkillRuns?.length) {
    const without = computeAnthropicRunSummary(withoutSkillRuns);
    result.run_summary.without_skill = without;
    result.run_summary.delta = {
      pass_rate: fixed(
        withSkill.pass_rate.mean - without.pass_rate.mean,
        2,
        true,
      ),
      time_seconds: fixed(
        withSkill.time_seconds.mean - without.time_seconds.mean,
        1,
        true,
      ),
      tokens: fixed(withSkill.tokens.mean - without.tokens.mean, 1, true),
    };
  }
  return result;
}
export const writeAnthropicBenchmark = (
  path: string,
  bm: AnthropicBenchmark | null,
) => writeJSONFile(path, bm, "anthropic benchmark");
