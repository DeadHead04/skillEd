// Modified for the skilled TypeScript distribution.
import type { Status } from "../judge/types.js";
import {
  type Input,
  type CaseResult,
  type Reporter,
  agentConfigurationModel,
  agentConfigurationVersion,
  configurationProtocol,
  overallPassRate,
  totalDuration,
} from "./reporter.js";
import { htmlEscape, fixed, writeToOutput } from "./helpers.js";
export const markdownText = (s: string): string =>
  htmlEscape(s.replaceAll("\r", " ").replaceAll("\n", " ").trim());
export const markdownTableCell = (s: string): string =>
  markdownText(s).replaceAll("|", "\\|") || "-";
export const markdownDuration = (ms: number): string =>
  fixed(ms / 1000, 1) + "s";
export const markdownCountByStatus = (input: Input, status: Status): number =>
  (input.case_results ?? []).filter((c) => c.status === status).length;
export const markdownHasJudgeMetrics = (input: Input): boolean =>
  (input.case_results ?? []).some(
    (c) =>
      !!(c.judge_duration_ms || c.judge_input_tokens || c.judge_output_tokens),
  );
export function writeMarkdownHeader(input: Input): string {
  let out = `# Skill Report: ${markdownText(input.skill_name)}\n\n`;
  const line = (key: string, v: string) => {
    if (v) out += `- **${key}**: ${markdownText(v)}\n`;
  };
  line("Engine", input.engine_name);
  line("Model", input.model_name);
  line("Protocol", configurationProtocol(input));
  line(
    "Requested Model",
    agentConfigurationModel(input.requested_configuration),
  );
  if (input.applied_configuration) {
    let applied = agentConfigurationModel(input.applied_configuration);
    if (!applied && input.requested_configuration?.model)
      applied = "none (delegated to local/default selection)";
    line("Applied Model", applied);
  }
  line(
    "Observed Model",
    agentConfigurationModel(input.observed_configuration) || "unknown",
  );
  line(
    "Requested Version",
    agentConfigurationVersion(input.requested_configuration),
  );
  line(
    "Applied Version",
    agentConfigurationVersion(input.applied_configuration),
  );
  line(
    "Observed Version",
    agentConfigurationVersion(input.observed_configuration),
  );
  return out + "\n";
}
export function writeMarkdownSummary(input: Input): string {
  return (
    "## Summary\n\n| Metric | Value |\n|---|---:|\n" +
    `| Total Cases | ${input.case_results?.length ?? 0} |\n| Passed | ${markdownCountByStatus(input, "PASS")} |\n| Failed | ${markdownCountByStatus(input, "FAIL")} |\n| Errors | ${markdownCountByStatus(input, "ERROR")} |\n| Skipped | ${markdownCountByStatus(input, "SKIP")} |\n| Pass Rate | ${fixed(overallPassRate(input) * 100, 1)}% |\n| Evaluation Wall Time | ${markdownDuration(Math.trunc(totalDuration(input)))} |\n| Tested Agent Tokens | ${input.total_tokens} |\n| Judge Tokens | ${input.judge_tokens} |\n| Overall Tokens | ${input.total_tokens + input.judge_tokens} |\n\n`
  );
}
function caseRows(input: Input, withJudge: boolean): string {
  return (
    (input.case_results ?? [])
      .map(
        (c) =>
          `| ${markdownTableCell(c.case_id)} | ${markdownTableCell(c.title)} | ${markdownTableCell(c.configuration ?? "")} | ${markdownTableCell(c.status)} | ${markdownDuration(c.duration_ms)} | ${c.input_tokens} | ${c.output_tokens} | ${c.input_tokens + c.output_tokens} | ` +
          (withJudge
            ? `${markdownDuration(c.judge_duration_ms ?? 0)} | ${(c.judge_input_tokens ?? 0) + (c.judge_output_tokens ?? 0)} | `
            : "") +
          `${c.turns} |\n`,
      )
      .join("") + "\n"
  );
}
export function writeMarkdownCasesWithJudgeMetrics(input: Input): string {
  return (
    "| Case | Title | Configuration | Status | Agent Time | Input Tokens | Output Tokens | Agent Tokens | Judge Time | Judge Tokens | Turns |\n|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|\n" +
    caseRows(input, true)
  );
}
export function writeMarkdownCases(input: Input): string {
  return (
    "## Cases\n\n" +
    (markdownHasJudgeMetrics(input)
      ? writeMarkdownCasesWithJudgeMetrics(input)
      : "| Case | Title | Configuration | Status | Agent Time | Input Tokens | Output Tokens | Agent Tokens | Turns |\n|---|---|---|---|---:|---:|---:|---:|---:|\n" +
        caseRows(input, false))
  );
}
export function writeMarkdownJudgeDetails(input: Input): string {
  let out = "";
  for (const c of input.case_results ?? []) {
    if (!c.judge_results?.length) continue;
    out += `### ${markdownText(c.case_id)}: gates and judges\n\n`;
    if (c.gates) {
      out += `- Gates: ${c.gates.passed}\n`;
      for (const failure of c.gates.failures ?? [])
        out += `  - ${markdownText(failure.rule)}: ${markdownText(failure.detail)}\n`;
    }
    for (const member of c.judge_results) {
      out += `- ${markdownText(member.id)} (${markdownText(member.type)}): ${member.status}`;
      if (member.result)
        out += `, ${member.result.summary.passed}/${member.result.summary.total} assertions`;
      if (member.error) out += `, ${markdownText(member.error)}`;
      if (member.skip_reason) out += `, ${markdownText(member.skip_reason)}`;
      out += "\n";
      for (const assertion of member.result?.assertion_results ?? []) {
        out += `  - ${assertion.passed}: ${markdownText(assertion.text)}`;
        if (assertion.evidence) out += ` — ${markdownText(assertion.evidence)}`;
        out += "\n";
      }
    }
    out += "\n";
  }
  return out;
}
export function writeMarkdownCaseDetails(c: CaseResult): string {
  let out = `### ${markdownText(c.case_id)}\n\n`;
  if (c.error) out += `- Error: ${markdownText(c.error)}\n`;
  if (c.grading?.error_reason)
    out += `- Error Reason: ${markdownText(c.grading.error_reason)}\n`;
  for (const a of c.grading?.assertion_results ?? []) {
    if (a.passed) continue;
    out += `- Failed: ${markdownText(a.text)}\n`;
    if (a.evidence) out += `  - Evidence: ${markdownText(a.evidence)}\n`;
  }
  for (const t of c.turn_results ?? []) {
    if (!t.status || t.status === "completed") continue;
    out += `- Turn ${t.turn_number}: status=${markdownText(t.status)}`;
    if (t.reason) out += ` reason=${markdownText(t.reason)}`;
    out += "\n";
  }
  return out + "\n";
}
export function writeMarkdownFailureDetails(input: Input): string {
  const details = (input.case_results ?? [])
    .filter((c) => c.status === "FAIL" || c.status === "ERROR")
    .map(writeMarkdownCaseDetails)
    .join("");
  return details ? "## Failure and Error Details\n\n" + details : "";
}
export const renderMarkdown = (input: Input): string =>
  writeMarkdownHeader(input) +
  writeMarkdownSummary(input) +
  writeMarkdownCases(input) +
  writeMarkdownJudgeDetails(input) +
  writeMarkdownFailureDetails(input);
export class MarkdownReporter implements Reporter {
  constructor(public outputPath = "") {}
  async write(input: Input, _signal?: AbortSignal): Promise<void> {
    await writeToOutput(
      this.outputPath,
      "markdown report",
      renderMarkdown(input),
    );
  }
}
