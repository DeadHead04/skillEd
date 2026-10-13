// Modified for the skilled TypeScript distribution.
import { serializeCaseResult } from "./json.js";
import type {
  ExpectResult,
  Outcome,
  SkillInfo,
  Status,
} from "../judge/types.js";
import {
  type Input,
  type CaseResult,
  type CaseTurnResult,
  type BenchmarkResult,
  type Reporter,
  agentConfigurationModel,
  agentConfigurationVersion,
  configurationProtocol,
  rfc3339,
  totalDuration,
  overallPassRate,
} from "./reporter.js";
import { readFile } from "node:fs/promises";
import { fixed, goJSON, htmlEscape, writeToOutput } from "./helpers.js";
export interface embeddedReportData {
  skill_name: string;
  engine_name: string;
  model_name: string;
  protocol: string;
  requested_model: string;
  applied_model: string;
  observed_model: string;
  requested_version: string;
  applied_version: string;
  observed_version: string;
  start_time: string;
  evaluation_wall_time: string;
  agent_tokens: number;
  judge_tokens: number;
  overall_tokens: number;
  summary: embeddedSummary;
  cases: embeddedCase[] | null;
  benchmark?: BenchmarkResult | null;
}
export interface embeddedSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  pass_rate: string;
}
export interface embeddedCase {
  id: string;
  title?: string;
  status: string;
  agent_duration_ms: number;
  agent_duration: string;
  input_tokens: number;
  output_tokens: number;
  agent_tokens: number;
  judge_duration_ms: number;
  judge_duration: string;
  judge_input_tokens: number;
  judge_output_tokens: number;
  judge_tokens: number;
  turns: number;
  error?: string;
  grading?: embeddedGrading | null;
  configuration?: string;
  prompt?: string;
  response?: string;
  baseline?: embeddedCase | null;
  turn_results?: embeddedTurn[] | null;
  judge_skills?: SkillInfo[] | null;
  gates?: ExpectResult | null;
  judge_results?: Outcome[] | null;
}
export interface embeddedTurn {
  turn_number: number;
  content: string;
  source?: string;
  response: string;
  status: string;
  reason?: string;
  stop_reason?: string;
}
export interface embeddedGrading {
  expectations: embeddedExpectation[] | null;
  summary: embeddedGradingSummary;
}
export interface embeddedExpectation {
  text: string;
  passed: boolean;
  evidence: string;
}
export interface embeddedGradingSummary {
  passed: number;
  failed: number;
  total: number;
  pass_rate: number;
}
export interface CaseGroup {
  withSkill?: CaseResult;
  withoutSkill?: CaseResult;
}
export interface HTMLReportData {
  skillName: string;
  logoDataURI: string;
  embeddedDataJSON: string;
}
export function caseTurnResultsToEmbedded(
  turns: CaseTurnResult[] | null | undefined,
): embeddedTurn[] | null {
  return turns?.length ? turns.map((t) => ({ ...t })) : null;
}
export function caseResultToEmbeddedCase(c: CaseResult): embeddedCase {
  c = serializeCaseResult(c) as unknown as CaseResult;
  const e: embeddedCase = {
    id: c.case_id,
    status: c.status,
    agent_duration_ms: c.duration_ms,
    agent_duration: fixed(c.duration_ms / 1000, 1) + "s",
    input_tokens: c.input_tokens,
    output_tokens: c.output_tokens,
    agent_tokens: c.input_tokens + c.output_tokens,
    judge_duration_ms: c.judge_duration_ms ?? 0,
    judge_duration: fixed((c.judge_duration_ms ?? 0) / 1000, 1) + "s",
    judge_input_tokens: c.judge_input_tokens ?? 0,
    judge_output_tokens: c.judge_output_tokens ?? 0,
    judge_tokens: (c.judge_input_tokens ?? 0) + (c.judge_output_tokens ?? 0),
    turns: c.turns,
  };
  for (const key of [
    "title",
    "error",
    "configuration",
    "prompt",
    "response",
  ] as const)
    if (c[key]) e[key] = c[key];
  if (c.turn_results?.length)
    e.turn_results = caseTurnResultsToEmbedded(c.turn_results);
  if (c.judge_skills?.length) e.judge_skills = c.judge_skills;
  if (c.gates) e.gates = c.gates;
  if (c.judge_results?.length) e.judge_results = c.judge_results;
  if (c.grading)
    e.grading = {
      expectations: (c.grading.assertion_results ?? []).map((a) => ({
        text: a.text,
        ...(a.skipped ? { skipped: true } : {}),
        passed: a.passed,
        evidence: a.evidence,
      })),
      summary: { ...c.grading.summary },
    };
  return e;
}
export function groupCaseResults(results: CaseResult[] | null): {
  grouped: Map<string, CaseGroup>;
  orderedIDs: string[];
} {
  const grouped = new Map<string, CaseGroup>();
  for (const c of results ?? []) {
    const group = grouped.get(c.case_id) ?? {};
    if (c.configuration === "without_skill") group.withoutSkill = c;
    else group.withSkill = c;
    grouped.set(c.case_id, group);
  }
  return { grouped, orderedIDs: [...grouped.keys()] };
}
export const primaryCaseResult = (group: CaseGroup): CaseResult =>
  (group.withSkill ?? group.withoutSkill)!;
export function countCaseStatuses(
  grouped: Map<string, CaseGroup>,
  orderedIDs: string[],
): { passed: number; failed: number; skipped: number; errored: number } {
  const counts = { passed: 0, failed: 0, skipped: 0, errored: 0 };
  for (const id of orderedIDs) {
    const status = primaryCaseResult(grouped.get(id)!).status;
    if (status === "PASS") counts.passed++;
    if (status === "FAIL") counts.failed++;
    if (status === "SKIP") counts.skipped++;
    if (status === "ERROR") counts.errored++;
  }
  return counts;
}
export function buildEmbeddedCases(
  grouped: Map<string, CaseGroup>,
  orderedIDs: string[],
): embeddedCase[] {
  return orderedIDs.map((id) => {
    const g = grouped.get(id)!,
      e = caseResultToEmbeddedCase(primaryCaseResult(g));
    if (g.withSkill && g.withoutSkill)
      e.baseline = caseResultToEmbeddedCase(g.withoutSkill);
    return e;
  });
}
export function buildEmbeddedReportData(input: Input): embeddedReportData {
  const { grouped, orderedIDs } = groupCaseResults(input.case_results),
    counts = countCaseStatuses(grouped, orderedIDs),
    cases = buildEmbeddedCases(grouped, orderedIDs);
  return {
    skill_name: input.skill_name,
    engine_name: input.engine_name,
    model_name: input.model_name,
    protocol: configurationProtocol(input),
    requested_model: agentConfigurationModel(input.requested_configuration),
    applied_model: agentConfigurationModel(input.applied_configuration),
    observed_model: agentConfigurationModel(input.observed_configuration),
    requested_version: agentConfigurationVersion(input.requested_configuration),
    applied_version: agentConfigurationVersion(input.applied_configuration),
    observed_version: agentConfigurationVersion(input.observed_configuration),
    start_time: rfc3339(input.start_time),
    evaluation_wall_time: fixed(totalDuration(input) / 1000, 1) + "s",
    agent_tokens: input.total_tokens,
    judge_tokens: input.judge_tokens,
    overall_tokens: input.total_tokens + input.judge_tokens,
    summary: {
      total: cases.length,
      passed: counts.passed,
      failed: counts.failed,
      skipped: counts.skipped,
      errors: counts.errored,
      pass_rate: fixed(overallPassRate(input) * 100, 0) + "%",
    },
    cases,
    ...(input.benchmark ? { benchmark: input.benchmark } : {}),
  };
}
export function statusIcon(status: Status | string): string {
  return (
    { PASS: "&#x2705;", FAIL: "&#x274C;", SKIP: "&#x23ED;", ERROR: "&#x26A0;" }[
      status
    ] ?? "?"
  );
}
export async function readReportAsset(file: string): Promise<Buffer> {
  try {
    return await readFile(
      new URL("../../assets/report/" + file, import.meta.url),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return readFile(new URL("../../../assets/report/" + file, import.meta.url));
  }
}
export class HTMLReporter implements Reporter {
  constructor(public outputPath = "") {}
  async buildTemplateData(input: Input): Promise<HTMLReportData> {
    return {
      skillName: input.skill_name,
      logoDataURI:
        "data:image/png;base64," +
        (await readReportAsset("logo.png")).toString("base64"),
      embeddedDataJSON: goJSON(buildEmbeddedReportData(input)),
    };
  }
  async render(input: Input): Promise<string> {
    const data = await this.buildTemplateData(input);
    return (await readReportAsset("report.html"))
      .toString("utf8")
      .replace(/^(\s*)\/\/[^\n]*$/gm, "$1")
      .replaceAll("{{.SkillName}}", htmlEscape(data.skillName))
      .replaceAll("{{.LogoDataURI}}", data.logoDataURI.replaceAll("+", "&#43;"))
      .replaceAll("{{.EmbeddedDataJSON}}", data.embeddedDataJSON);
  }
  async write(input: Input, _signal?: AbortSignal): Promise<void> {
    await writeToOutput(
      this.outputPath,
      "html report",
      await this.render(input),
    );
  }
}
export const writeHTMLReport = (
  path: string,
  input: Input,
  signal?: AbortSignal,
) => new HTMLReporter(path).write(input, signal);
