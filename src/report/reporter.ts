// Modified for the skilled TypeScript distribution.
import type {
  Result,
  ExpectResult,
  Outcome,
  SkillInfo,
  Status,
} from "../judge/types.js";
export interface Input {
  skill_name: string;
  schema_version: string;
  engine_name: string;
  model_name: string;
  requested_configuration?: AgentConfiguration | null;
  applied_configuration?: AgentConfiguration | null;
  observed_configuration?: AgentConfiguration | null;
  start_time: string | Date;
  end_time: string | Date;
  case_results: CaseResult[] | null;
  total_tokens: number;
  judge_tokens: number;
  overall_tokens: number;
  benchmark?: BenchmarkResult | null;
}
export interface AgentConfiguration {
  role?: string;
  engine?: string;
  protocol?: string;
  provider?: string;
  model?: string;
  version?: string;
}
export interface CaseResult {
  case_id: string;
  title: string;
  status: Status;
  duration_ms: number;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  judge_duration_ms?: number;
  judge_input_tokens?: number;
  judge_output_tokens?: number;
  error?: string;
  grading: Result | null;
  gates?: ExpectResult | null;
  judge_results?: Outcome[] | null;
  judge_skills?: SkillInfo[] | null;
  configuration?: string;
  prompt?: string;
  response?: string;
  observed_model?: string;
  observed_version?: string;
  turn_results?: CaseTurnResult[] | null;
}
export interface CaseTurnResult {
  turn_number: number;
  content: string;
  source?: string;
  response: string;
  status: string;
  reason?: string;
  stop_reason?: string;
}
export interface BenchmarkResult {
  run_summary: BenchmarkRunSummary;
}
export interface BenchmarkRunSummary {
  with_skill: BenchmarkStats;
  without_skill: BenchmarkStats | null;
  delta: BenchmarkDelta | null;
}
export interface BenchmarkStats {
  pass_rate: StatValue;
  time_seconds: StatValue;
  input_tokens: StatValue;
  output_tokens: StatValue;
}
export interface StatValue {
  mean: number;
  stddev: number;
}
export interface BenchmarkDelta {
  pass_rate: number;
  time_seconds: number;
  input_tokens: number;
  output_tokens: number;
}
export interface Reporter {
  write(input: Input, signal?: AbortSignal): Promise<void>;
}
export const agentConfigurationModel = (
  c?: AgentConfiguration | null,
): string => (c?.model ? (c.provider ? c.provider + "/" : "") + c.model : "");
export const agentConfigurationVersion = (
  c?: AgentConfiguration | null,
): string => c?.version ?? "";
export const zeroTime = "0001-01-01T00:00:00Z";
export function rfc3339(value?: string | Date): string {
  if (!value) return zeroTime;
  const s = value instanceof Date ? value.toISOString() : value;
  return s.replace(/\.\d+(?=Z|[+-]\d\d:\d\d$)/, "");
}
// Keep RFC3339 nanoseconds until subtraction; Date alone truncates them.
function epochNanoseconds(value: string | Date): bigint {
  if (value instanceof Date) return BigInt(value.getTime()) * 1_000_000n;
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:[.,](\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return BigInt(new Date(value).getTime()) * 1_000_000n;
  const milliseconds = Date.parse(match[1] + match[3]);
  return BigInt(milliseconds) * 1_000_000n + BigInt((match[2] ?? "").padEnd(9, "0").slice(0, 9));
}
export function totalDuration(input: Input): number {
  const a = input.start_time,
    b = input.end_time;
  if (a && b) {
    const start = epochNanoseconds(a), end = epochNanoseconds(b), zero = epochNanoseconds(zeroTime);
    if (start !== zero && end !== zero) {
      let duration = end - start;
      // time.Time.Sub saturates when the difference exceeds time.Duration.
      if (duration > (1n << 63n) - 1n) duration = (1n << 63n) - 1n;
      if (duration < -(1n << 63n)) duration = -(1n << 63n);
      return Number(duration) / 1_000_000;
    }
  }
  return (input.case_results ?? []).reduce((n, c) => n + c.duration_ms, 0);
}
export function primaryCaseResults(input: Input): CaseResult[] {
  const results = new Map<string, CaseResult>();
  for (const c of input.case_results ?? []) {
    const old = results.get(c.case_id);
    if (
      c.configuration === "with_skill" ||
      !old ||
      old.configuration === "without_skill"
    )
      results.set(c.case_id, c);
  }
  return [...results.values()];
}
export function overallPassRate(input: Input): number {
  const primary = primaryCaseResults(input);
  return primary.length
    ? primary.filter((c) => c.status === "PASS").length / primary.length
    : 0;
}
export function configurationProtocol(input: Input): string {
  return (
    (input.applied_configuration ?? input.requested_configuration)?.protocol ??
    ""
  );
}
export function newInput(input: Partial<Input> = {}): Input {
  return {
    skill_name: "",
    schema_version: "",
    engine_name: "",
    model_name: "",
    start_time: zeroTime,
    end_time: zeroTime,
    case_results: null,
    total_tokens: 0,
    judge_tokens: 0,
    overall_tokens: 0,
    ...input,
  };
}
export function newCaseResult(input: Partial<CaseResult> = {}): CaseResult {
  return {
    case_id: "",
    title: "",
    status: "" as Status,
    duration_ms: 0,
    turns: 0,
    input_tokens: 0,
    output_tokens: 0,
    grading: null,
    ...input,
  };
}
