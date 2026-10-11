// Modified for the skilled TypeScript distribution.
import type {
  BenchmarkStats,
  BenchmarkDelta,
  BenchmarkResult,
  CaseResult,
} from "./reporter.js";
export interface CaseMetrics {
  passed: boolean;
  time_seconds: number;
  input_tokens: number;
  output_tokens: number;
}
export const mean = (values: number[]): number =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => {
      const d = value - avg;
      return sum + d * d;
    }, 0) / values.length,
  );
}
export const passRate = (passed: boolean[]): number =>
  passed.length ? passed.filter(Boolean).length / passed.length : 0;
export function computeBenchmarkStats(
  metrics: CaseMetrics[] | null,
): BenchmarkStats {
  const rows = metrics ?? [];
  const stat = (vals: number[]) => ({ mean: mean(vals), stddev: stdDev(vals) });
  return {
    pass_rate: stat(rows.map((m) => (m.passed ? 1 : 0))),
    time_seconds: stat(rows.map((m) => m.time_seconds)),
    input_tokens: stat(rows.map((m) => m.input_tokens)),
    output_tokens: stat(rows.map((m) => m.output_tokens)),
  };
}
export function computeBenchmarkDelta(
  withSkill: BenchmarkStats,
  withoutSkill: BenchmarkStats,
): BenchmarkDelta {
  return {
    pass_rate: withSkill.pass_rate.mean - withoutSkill.pass_rate.mean,
    time_seconds: withSkill.time_seconds.mean - withoutSkill.time_seconds.mean,
    input_tokens: withSkill.input_tokens.mean - withoutSkill.input_tokens.mean,
    output_tokens:
      withSkill.output_tokens.mean - withoutSkill.output_tokens.mean,
  };
}
export function computeBenchmark(
  withSkill: CaseMetrics[] | null,
  withoutSkill: CaseMetrics[] | null = null,
): BenchmarkResult {
  const withStats = computeBenchmarkStats(withSkill),
    withoutStats =
      withoutSkill === null ? null : computeBenchmarkStats(withoutSkill);
  return {
    run_summary: {
      with_skill: withStats,
      without_skill: withoutStats,
      delta: withoutStats
        ? computeBenchmarkDelta(withStats, withoutStats)
        : null,
    },
  };
}
export const extractMetrics = (results: CaseResult[] | null): CaseMetrics[] =>
  (results ?? []).map((r) => ({
    passed: r.status === "PASS",
    time_seconds: r.duration_ms / 1000,
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
  }));
