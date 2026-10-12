import { open } from "node:fs/promises";
import { constants } from "node:fs";
import type { Status } from "../judge/types.js";

export interface ComparisonCase {
  caseID: string;
  configuration: string;
  change: "added" | "removed" | "changed" | "unchanged";
  beforeStatus: Status | null;
  afterStatus: Status | null;
  statusChanged: boolean;
  regression: boolean;
  improvement: boolean;
  score: { before: number; after: number; delta: number } | null;
  warnings: string[];
}
export interface ComparisonResult {
  schemaVersion: 1;
  summary: {
    before: number; after: number; matched: number; added: number; removed: number;
    changed: number; unchanged: number; statusChanges: number;
    regressions: number; improvements: number; comparableScores: number;
  };
  cases: ComparisonCase[];
  warnings: string[];
  hasRegressions: boolean;
}
interface Score {
  value: number;
  rubric: string;
}
interface ComparableCase {
  caseID: string;
  configuration: string;
  status: Status;
  prompt?: string;
  score: Score | null;
}
export interface ComparisonInput {
  skillName?: string;
  schemaVersion?: string;
  engineName?: string;
  modelName?: string;
  configurations: Record<string, string>;
  cases: ComparableCase[];
}
const statuses = new Set(["PASS", "FAIL", "ERROR", "SKIP"]);
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}
function status(value: unknown, label: string): Status {
  if (typeof value !== "string" || !statuses.has(value))
    throw new Error(`${label} must be PASS, FAIL, ERROR or SKIP`);
  return value as Status;
}
function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${label} must be a finite number`);
  return value;
}
function integer(value: unknown, label: string): number {
  const n = finite(value, label);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${label} must be a nonnegative safe integer`);
  return n;
}
function key(item: { caseID: string; configuration: string }): string {
  return JSON.stringify([item.caseID, item.configuration]);
}
function gradingScore(value: unknown, label: string, judges: unknown): Score | null {
  if (value == null) return null;
  const grading = object(value, label);
  status(grading.status, `${label}.status`);
  const summary = object(grading.summary, `${label}.summary`);
  const total = integer(summary.total, `${label}.summary.total`);
  const passed = integer(summary.passed, `${label}.summary.passed`);
  const failed = integer(summary.failed, `${label}.summary.failed`);
  const rate = finite(summary.pass_rate, `${label}.summary.pass_rate`);
  if (passed + failed !== total || rate < 0 || rate > 1 || (total ? Math.abs(rate - passed / total) > 1e-9 : rate !== 0 && rate !== 1))
    throw new Error(`${label}.summary has inconsistent counts or pass_rate`);
  if (!Array.isArray(grading.assertion_results)) throw new Error(`${label}.assertion_results must be an array`);
  const assertions = grading.assertion_results.map((value, i) => {
    const a = object(value, `${label}.assertion_results[${i}]`);
    if (typeof a.text !== "string" || typeof a.passed !== "boolean")
      throw new Error(`${label}.assertion_results[${i}] requires text and passed`);
    return { text: a.text, passed: a.passed };
  });
  if (assertions.length !== total || assertions.filter(a => a.passed).length !== passed)
    throw new Error(`${label} assertions do not match summary counts`);
  let judgeSignature: string[] = [];
  if (judges != null) {
    if (!Array.isArray(judges)) throw new Error(`${label}: judge_results must be an array`);
    judgeSignature = judges.map((value, i) => {
      const j = object(value, `judge_results[${i}]`);
      if (typeof j.id !== "string" || !j.id || typeof j.type !== "string" || !j.type)
        throw new Error(`judge_results[${i}] requires id and type`);
      status(j.status, `judge_results[${i}].status`);
      return JSON.stringify([j.id, j.type]);
    });
    if (new Set(judgeSignature).size !== judgeSignature.length) throw new Error("duplicate judge_results key");
  }
  if (!total || assertions.some(a => !a.text.trim()) || !["PASS", "FAIL"].includes(grading.status as string)) return null;
  return { value: rate, rubric: JSON.stringify([assertions.map(a => a.text), judgeSignature.sort()]) };
}
/** Validate the result.json/report.json fields used by comparison; never fill in missing verdicts. */
export function validateComparisonInput(value: unknown): ComparisonInput {
  const report = object(value, "report");
  if (!Array.isArray(report.case_results)) throw new Error("report.case_results must be an array");
  const configurations: Record<string, string> = {};
  for (const field of ["requested_configuration", "applied_configuration", "observed_configuration"]) {
    if (report[field] == null) continue;
    const config = object(report[field], field);
    for (const part of ["role", "engine", "protocol", "provider", "model", "version"]) {
      const item = optionalString(config[part], `${field}.${part}`);
      if (item) configurations[`${field}.${part}`] = item;
    }
  }
  const seen = new Set<string>();
  const cases = report.case_results.map((value, i): ComparableCase => {
    const c = object(value, `case_results[${i}]`);
    if (typeof c.case_id !== "string" || !c.case_id.trim()) throw new Error(`case_results[${i}].case_id must be a nonempty string`);
    const configuration = optionalString(c.configuration, `case_results[${i}].configuration`) ?? "";
    const result: ComparableCase = {
      caseID: c.case_id,
      configuration,
      status: status(c.status, `case_results[${i}].status`),
      prompt: optionalString(c.prompt, `case_results[${i}].prompt`),
      score: gradingScore(c.grading, `case_results[${i}].grading`, c.judge_results),
    };
    if (seen.has(key(result))) throw new Error(`duplicate case key: ${key(result)}`);
    seen.add(key(result));
    return result;
  });
  return {
    skillName: optionalString(report.skill_name, "skill_name"),
    schemaVersion: optionalString(report.schema_version, "schema_version"),
    engineName: optionalString(report.engine_name, "engine_name"),
    modelName: optionalString(report.model_name, "model_name"),
    configurations, cases,
  };
}
/** Parse JSON without silently accepting duplicate object members. */
export const MAX_COMPARISON_FILE_BYTES = 32 * 1024 * 1024;
export function parseComparisonInput(text: string): unknown {
  if (Buffer.byteLength(text, "utf8") > MAX_COMPARISON_FILE_BYTES) throw new Error("comparison input exceeds 32 MiB limit");
  const parsed: unknown = JSON.parse(text);
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]:,]/gs) ?? [];
  let position = 0;
  function visit(depth = 0): void {
    if (depth > 128) throw new Error("comparison input exceeds maximum nesting depth of 128");
    const token = tokens[position++];
    if (token === "{") {
      const seen = new Set<string>();
      while (tokens[position] !== "}") {
        const name = JSON.parse(tokens[position++]) as string;
        if (seen.has(name)) throw new Error(`duplicate JSON property: ${JSON.stringify(name)}`);
        seen.add(name); position++; visit(depth + 1);
        if (tokens[position] !== ",") break;
        position++;
      }
      position++;
    } else if (token === "[") {
      while (tokens[position] !== "]") {
        visit(depth + 1);
        if (tokens[position] !== ",") break;
        position++;
      }
      position++;
    }
  }
  visit();
  validateComparisonInput(parsed);
  return parsed;
}
/** Compare existing reports, matching the pair (case_id, configuration), without running agents. */
export function compareResults(before: unknown, after: unknown): ComparisonResult {
  const a = validateComparisonInput(before), b = validateComparisonInput(after);
  const warnings = ["Reports do not contain complete evaluation-input, skill, fixture and judge-configuration fingerprints. Matching case IDs and prompts do not prove equivalent inputs or grading conditions."];
  let incompatible = false;
  for (const field of ["skillName", "schemaVersion", "engineName", "modelName"] as const) {
    if (!a[field] || !b[field]) warnings.push(`Missing ${field} provenance in one or both reports.`);
    else if (a[field] !== b[field]) {
      warnings.push(`${field} differs between reports.`);
      if (field === "skillName" || field === "schemaVersion") incompatible = true;
    }
  }
  for (const field of new Set([...Object.keys(a.configurations), ...Object.keys(b.configurations)])) {
    if (a.configurations[field] !== b.configurations[field]) warnings.push(`${field} differs or is missing in one report.`);
  }
  if (!Object.keys(a.configurations).length || !Object.keys(b.configurations).length)
    warnings.push("Agent configuration provenance is missing in one or both reports.");
  const left = new Map(a.cases.map(c => [key(c), c])), right = new Map(b.cases.map(c => [key(c), c]));
  const cases: ComparisonCase[] = [];
  for (const k of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const old = left.get(k), current = right.get(k), identity = current ?? old!;
    const item: ComparisonCase = {
      caseID: identity.caseID, configuration: identity.configuration,
      change: !old ? "added" : !current ? "removed" : "unchanged",
      beforeStatus: old?.status ?? null, afterStatus: current?.status ?? null,
      statusChanged: !!old && !!current && old.status !== current.status,
      regression: false, improvement: false, score: null, warnings: [],
    };
    if (!identity.configuration) item.warnings.push("Configuration is unspecified; this case is matched only to another unspecified configuration.");
    if (old && current) {
      if (old.score?.rubric.includes("expect.") || current.score?.rubric.includes("expect.")) item.warnings.push("The assertion rubric may include legacy expectation gates. Regenerate baselines with the same scoring version before interpreting score changes.");
      if (!old.prompt || !current.prompt) item.warnings.push("Prompt provenance is missing; input equivalence is unverified.");
      else if (old.prompt !== current.prompt) item.warnings.push("Prompts differ; these verdicts may cover different inputs.");
      const samePrompt = !!old.prompt && old.prompt === current.prompt;
      if (old.score && current.score && old.score.rubric === current.score.rubric && samePrompt && !incompatible
        && ["PASS", "FAIL"].includes(old.status) && ["PASS", "FAIL"].includes(current.status)) {
        item.score = { before: old.score.value, after: current.score.value, delta: current.score.value - old.score.value };
      } else item.warnings.push("Scores are not comparable: matching nonempty prompts, assertion rubrics, judge identities, report identity and scored verdicts are required.");
      item.regression = (old.status === "PASS" && current.status !== "PASS") || (item.score !== null && item.score.delta < 0);
      item.improvement = (old.status !== "PASS" && current.status === "PASS") || (item.score !== null && item.score.delta > 0);
      if (item.statusChanged || (item.score !== null && item.score.delta !== 0)) item.change = "changed";
    }
    cases.push(item);
  }
  const count = (predicate: (c: ComparisonCase) => boolean): number => cases.filter(predicate).length;
  const summary = {
    before: a.cases.length, after: b.cases.length,
    matched: count(c => c.beforeStatus !== null && c.afterStatus !== null),
    added: count(c => c.change === "added"), removed: count(c => c.change === "removed"),
    changed: count(c => c.change === "changed"), unchanged: count(c => c.change === "unchanged"),
    statusChanges: count(c => c.statusChanged), regressions: count(c => c.regression),
    improvements: count(c => c.improvement), comparableScores: count(c => c.score !== null),
  };
  if (summary.added || summary.removed) warnings.push("Case coverage changed; added and removed cases are reported separately and are not classified as regressions or improvements.");
  return { schemaVersion: 1, summary, cases, warnings, hasRegressions: summary.regressions > 0 };
}
async function readBoundedReport(file: string): Promise<string> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("comparison input must be a regular file");
    if (stat.size > MAX_COMPARISON_FILE_BYTES) throw new Error("comparison input exceeds 32 MiB limit");
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_COMPARISON_FILE_BYTES + 1 - total));
      const { bytesRead } = await handle.read(chunk);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > MAX_COMPARISON_FILE_BYTES) throw new Error("comparison input exceeds 32 MiB limit");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { await handle.close(); }
}
export async function compareResultFiles(beforePath: string, afterPath: string): Promise<ComparisonResult> {
  const [before, after] = await Promise.all([readBoundedReport(beforePath), readBoundedReport(afterPath)]);
  return compareResults(parseComparisonInput(before), parseComparisonInput(after));
}
export function renderComparisonText(result: ComparisonResult): string {
  const s = result.summary;
  const lines = [
    `Compared ${s.matched} matched cases: ${s.regressions} regressions, ${s.improvements} improvements.`,
    `Coverage: ${s.added} added, ${s.removed} removed. ${s.statusChanges} status changes; ${s.comparableScores} comparable scores.`,
    "Regression policy: PASS to any non-PASS status, or a decrease in a comparable assertion pass rate.",
  ];
  for (const c of result.cases) {
    const score = c.score ? `; score ${c.score.before} -> ${c.score.after} (delta ${c.score.delta >= 0 ? "+" : ""}${c.score.delta})` : "";
    lines.push(`${JSON.stringify(c.caseID)} [${JSON.stringify(c.configuration || "(unspecified)")}] ${c.change}: ${c.beforeStatus ?? "absent"} -> ${c.afterStatus ?? "absent"}${score}${c.regression ? " REGRESSION" : ""}`);
    for (const warning of c.warnings) lines.push(`  Warning: ${warning}`);
  }
  for (const warning of result.warnings) lines.push(`Warning: ${warning}`);
  return lines.join("\n") + "\n";
}
