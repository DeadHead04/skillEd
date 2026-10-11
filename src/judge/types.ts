// Modified for the skilled TypeScript distribution.
import type { Context } from "@opentelemetry/api";
import type { SessionResult } from "../agent/types.js";
import type { Transcript } from "../contracts/transcript.js";
export type Status = "PASS" | "FAIL" | "SKIP" | "ERROR";
export const statusPass: Status = "PASS",
  statusFail: Status = "FAIL",
  statusSkip: Status = "SKIP",
  statusError: Status = "ERROR";
export interface InputTurnResult {
  turnNumber: number;
  content: string;
  response: string;
  transcript: Transcript;
  status: string;
  reason: string;
}
export interface Input {
  caseID?: string;
  transcript?: Transcript;
  finalMessage?: string;
  exitCode?: number;
  workspacePath?: string;
  skillDir?: string;
  workspaceDiff?: string;
  generatedFiles?: string[];
  artifactDir?: string;
  contextArtifactDir?: string;
  sessionResult?: SessionResult | null;
  turnResults?: InputTurnResult[];
  turnsExecuted?: number;
  turnsTotal?: number;
}
export type ResolvedInput = Required<Input>;
export function resolveInput(input: Input): ResolvedInput {
  return {
    caseID: "",
    transcript: [],
    finalMessage: "",
    exitCode: 0,
    workspacePath: "",
    skillDir: "",
    workspaceDiff: "",
    generatedFiles: [],
    artifactDir: "",
    contextArtifactDir: "",
    sessionResult: null,
    turnResults: [],
    turnsExecuted: 0,
    turnsTotal: 0,
    ...input,
  };
}
export interface Judge {
  evaluate(
    input: Input,
    signal?: AbortSignal,
    context?: Context,
  ): Promise<Result>;
}
export interface AssertionResult {
  text: string;
  passed: boolean;
  evidence: string;
}
export interface ResultSummary {
  passed: number;
  failed: number;
  total: number;
  pass_rate: number;
}
export interface Result {
  status: Status;
  skip_reason?: string;
  error_reason?: string;
  turns_executed: number;
  turns_total: number;
  assertion_results: AssertionResult[];
  summary: ResultSummary;
  judgeSession?: SessionResult | null;
  judge_context?: ContextMetadata;
}
export interface Outcome {
  id: string;
  type: string;
  status: Status;
  result?: Result | null;
  error?: string;
  skip_reason?: string;
  artifacts_dir?: string;
  duration_ms: number;
  session?: SessionResult | null;
  judge_skills?: SkillInfo[];
}
export interface SkillInfo {
  source?: string;
  path?: string;
  target?: string;
  include?: string[];
  exclude?: string[];
  name?: string;
}
export interface ContextMetadata {
  profile: string;
  materialized_dir?: string;
  manifest?: ContextManifest;
  prompt_delivery?: string;
  prompt_bytes?: number;
}
export interface ContextManifest {
  profile: string;
  materialized_dir?: string;
  runtime_dir?: string;
  materials: ContextMaterialManifest[];
}
export interface ContextMaterialManifest {
  key: string;
  label?: string;
  mode: string;
  path?: string;
  bytes: number;
  original_bytes?: number;
  truncated?: boolean;
}
export interface ContextMaterial extends ContextMaterialManifest {
  inlineContent: string;
  runtimePath: string;
}
export interface MaterializedContext {
  dir: string;
  runtimeDir: string;
  manifest: ContextManifest;
  materials: ContextMaterial[];
}
export interface ExpectFailure {
  rule: string;
  detail: string;
}
export interface ExpectResult {
  passed: boolean;
  failures: ExpectFailure[] | null;
  configured_rules: string[] | null;
}
export function newResult(
  assertions: AssertionResult[] | null,
  turnsExecuted = 0,
  turnsTotal = 0,
): Result {
  const values = assertions ?? [],
    passed = values.filter((a) => a.passed).length,
    failed = values.length - passed;
  return {
    status: failed ? "FAIL" : "PASS",
    turns_executed: turnsExecuted,
    turns_total: turnsTotal,
    assertion_results: values,
    summary: {
      passed,
      failed,
      total: values.length,
      pass_rate: values.length ? passed / values.length : 1,
    },
  };
}
export function newSkipResult(
  reason: string,
  turnsExecuted = 0,
  turnsTotal = 0,
): Result {
  return {
    ...newResult([], turnsExecuted, turnsTotal),
    status: "SKIP",
    skip_reason: reason,
    summary: { passed: 0, failed: 0, total: 0, pass_rate: 0 },
  };
}
export function newErrorResult(
  error: Error,
  turnsExecuted = 0,
  turnsTotal = 0,
): Result {
  return {
    status: "ERROR",
    error_reason: error.message,
    turns_executed: turnsExecuted,
    turns_total: turnsTotal,
    assertion_results: [],
    summary: { passed: 0, failed: 0, total: 0, pass_rate: 0 },
  };
}

export class SessionResultError extends Error {
  constructor(
    error: Error,
    readonly session: SessionResult | null,
  ) {
    super(error.message, { cause: error });
    this.name = "SessionResultError";
  }
}
export function sessionResultFromError(error: unknown): SessionResult | null {
  for (let e = error; e instanceof Error; e = e.cause)
    if (e instanceof SessionResultError) return e.session;
  return null;
}
export function setJudgeSession(result: Result, session: SessionResult): void {
  Object.defineProperty(result, "judgeSession", {
    value: session,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
export function normalizeOutcome(outcome: Outcome): Outcome {
  if (outcome.session)
    Object.defineProperty(outcome, "session", {
      value: outcome.session,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  return outcome;
}
