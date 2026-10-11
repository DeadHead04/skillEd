// Modified for the skilled TypeScript distribution.
import type { Writable } from "node:stream";
import type {
  AnthropicBenchmark,
  BenchmarkRun,
} from "./benchmark-anthropic.js";
import type { AnthropicExpectation } from "./grading.js";
import { fixed, writeStream, writeToOutput } from "./helpers.js";
export const collectEvalNames = (runs: BenchmarkRun[] | null): string[] => [
  ...new Set((runs ?? []).map((r) => r.eval_name)),
];
export function writeBenchmarkSummary(bm: AnthropicBenchmark): string {
  const ws = bm.run_summary.with_skill.pass_rate;
  let text = "## Summary\n\n";
  if (!bm.run_summary.without_skill)
    return (
      text +
      "| Metric | With Skill |\n|--------|------------|\n" +
      `| Pass Rate | ${fixed(ws.mean * 100, 0)}% ± ${fixed(ws.stddev * 100, 0)}% |\n`
    );
  const wos = bm.run_summary.without_skill.pass_rate;
  return (
    text +
    "| Metric | With Skill | Without Skill | Delta |\n|--------|-----------|--------------|-------|\n" +
    `| Pass Rate | ${fixed(ws.mean * 100, 0)}% ± ${fixed(ws.stddev * 100, 0)}% | ${fixed(wos.mean * 100, 0)}% ± ${fixed(wos.stddev * 100, 0)}% | ${bm.run_summary.delta?.pass_rate ?? ""} |\n`
  );
}
export function writeBenchmarkExpectations(
  expectations: AnthropicExpectation[] | null,
): string {
  if (!expectations?.length) return "";
  return (
    "\n| Expectation | Result | Evidence |\n|-------------|--------|----------|\n" +
    expectations
      .map((e) => `| ${e.text} | ${e.passed ? "✅" : "❌"} | ${e.evidence} |\n`)
      .join("")
  );
}
export const writeBenchmarkRun = (run: BenchmarkRun): string =>
  `### ${run.eval_name} (${run.configuration})\n\n- **Pass Rate**: ${fixed(run.result.pass_rate * 100, 0)}% (${run.result.passed}/${run.result.total})\n` +
  writeBenchmarkExpectations(run.expectations) +
  "\n";
export const writeBenchmarkPerCase = (runs: BenchmarkRun[] | null): string =>
  runs?.length
    ? "\n## Per-Case Results\n\n" + runs.map(writeBenchmarkRun).join("")
    : "";
export const renderBenchmarkMarkdown = (bm: AnthropicBenchmark): string =>
  `# Skill Benchmark: ${bm.metadata.skill_name}\n\n**Date**: ${bm.metadata.timestamp}\n**Evals**: ${collectEvalNames(bm.runs).join(", ")} (${bm.metadata.runs_per_configuration} runs each per configuration)\n\n` +
  writeBenchmarkSummary(bm) +
  writeBenchmarkPerCase(bm.runs);
export const writeBenchmarkMarkdown = (
  writer: Writable,
  bm: AnthropicBenchmark,
) => writeStream(writer, renderBenchmarkMarkdown(bm));
export const writeBenchmarkMarkdownFile = (
  path: string,
  bm: AnthropicBenchmark,
) => writeToOutput(path, "benchmark md", renderBenchmarkMarkdown(bm));
