// Modified for the skilled TypeScript distribution.
import type {
  EvalConfig,
  CaseConfig,
  Expect,
  RetryPolicy,
  FileContainsCheck,
  SkillRef,
} from "../contracts/schema.js";
import type { SessionResult } from "../agent/types.js";
import type { Transcript } from "../contracts/transcript.js";
import type { EvalResult, TurnResult } from "./types.js";
import type { InputTurnResult } from "../judge/types.js";
import path from "node:path";
export const asError = (e: unknown): Error =>
  e instanceof Error ? e : new Error(String(e));
export const deadlineBySignal = new WeakMap<AbortSignal, number>();
export function boundedSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): { signal?: AbortSignal; cancel: () => void } {
  if (timeoutMs <= 0) return { signal: parent, cancel: () => {} };
  const controller = new AbortController(),
    deadline = Date.now() + timeoutMs;
  deadlineBySignal.set(
    controller.signal,
    Math.min(
      deadline,
      parent ? (deadlineBySignal.get(parent) ?? Infinity) : Infinity,
    ),
  );
  const aborted = () => controller.abort(parent?.reason);
  if (parent?.aborted) aborted();
  else parent?.addEventListener("abort", aborted, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException("context deadline exceeded", "TimeoutError"),
      ),
    timeoutMs,
  );
  timer.unref();
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", aborted);
    },
  };
}
export function withCaseTimeout(
  parent: AbortSignal | undefined,
  defaultSeconds: number,
  caseSeconds: number,
) {
  const seconds =
    caseSeconds > 0 ? caseSeconds : defaultSeconds > 0 ? defaultSeconds : 0;
  return {
    ...boundedSignal(parent, seconds * 1000),
    source:
      caseSeconds > 0
        ? "case.constraints.timeout_seconds"
        : seconds
          ? "cases.defaults.timeout_seconds"
          : "",
    seconds,
  };
}
export function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (
    error.name === "TimeoutError" ||
    error.message === "context deadline exceeded"
  )
    return true;
  if (error instanceof AggregateError && error.errors.some(isTimeoutError))
    return true;
  return error.cause !== error && isTimeoutError(error.cause);
}
export function annotateCaseTimeoutError(
  result: EvalResult,
  source: string,
  seconds: number,
): void {
  if (result.error && source && seconds > 0 && isTimeoutError(result.error))
    result.error = new Error(
      `${result.error.message} (case timeout ${seconds}s via ${source})`,
      { cause: result.error },
    );
}
export function retryAllowed(policy: RetryPolicy, reason: string): boolean {
  return (
    !!reason &&
    policy.max_retries > 0 &&
    policy.retry_on.some((v) => v.toLowerCase() === reason.toLowerCase())
  );
}
export const retryReasonForResult = (result: EvalResult): string =>
  result.status === "ERROR" && result.error
    ? isTimeoutError(result.error)
      ? "timeout"
      : "error"
    : "";
export const retryBackoffDelay = (attempt: number): number =>
  2 ** Math.max(attempt, 1) * 1000;
export async function sleepContext(
  delay: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, delay);
    signal?.addEventListener("abort", stop, { once: true });
  });
}
export function casePromptAndTurnsTotal(cfg: CaseConfig): {
  prompt: string;
  turnsTotal: number;
} {
  return {
    prompt: cfg.input.prompt || cfg.input.turns[0]?.content || "",
    turnsTotal: cfg.input.turns.length || 1,
  };
}
export const caseMaxTurns = (evalCfg: EvalConfig, cfg: CaseConfig): number =>
  cfg.constraints.max_turns > 0
    ? cfg.constraints.max_turns
    : evalCfg.cases.defaults.max_turns;
export const caseTimeoutSeconds = (
  evalCfg: EvalConfig,
  cfg: CaseConfig,
): number =>
  cfg.constraints.timeout_seconds > 0
    ? cfg.constraints.timeout_seconds
    : evalCfg.cases.defaults.timeout_seconds;
export function buildCaseMessages(cfg: CaseConfig): Transcript {
  return cfg.input.prompt
    ? [{ role: "user", content: cfg.input.prompt, turn: 1 }]
    : cfg.input.turns.map((t, i) => ({
        role: t.role || "user",
        content: t.content,
        turn: i + 1,
      }));
}
export function normalizeSessionResult(
  session?: SessionResult | null,
): SessionResult {
  const result = { exit_code: 0, duration_ms: 0, turns: 0, ...session };
  const final = result.transcript?.findLast(
    (m) => m.role === "assistant",
  )?.content;
  if (final) result.final_message = final;
  return result;
}
export const mergeAndDeduplicate = (
  a: string[] = [],
  b: string[] = [],
): string[] => [...new Set([...a, ...b])];
export function mergeFileContains(
  a: FileContainsCheck[] = [],
  b: FileContainsCheck[] = [],
): FileContainsCheck[] {
  const seen = new Set<string>();
  return [...a, ...b].filter((c) => {
    const key = JSON.stringify([c.path, c.content]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function mergeExpectConfig(
  defaults: Expect | null | undefined,
  local: Expect | null | undefined,
): Expect {
  if (!defaults)
    return (
      local ?? {
        must_contain: [],
        must_not_contain: [],
        files_exist: [],
        files_not_exist: [],
        file_contains: [],
        exit_code: null,
        golden_file: "",
      }
    );
  if (!local) return defaults;
  return {
    must_contain: mergeAndDeduplicate(
      defaults.must_contain,
      local.must_contain,
    ),
    must_not_contain: mergeAndDeduplicate(
      defaults.must_not_contain,
      local.must_not_contain,
    ),
    files_exist: mergeAndDeduplicate(defaults.files_exist, local.files_exist),
    files_not_exist: mergeAndDeduplicate(
      defaults.files_not_exist,
      local.files_not_exist,
    ),
    file_contains: mergeFileContains(
      defaults.file_contains,
      local.file_contains,
    ),
    exit_code: local.exit_code ?? defaults.exit_code,
    golden_file: local.golden_file || defaults.golden_file,
  };
}
export const resolveExpectConfig = (e: Expect): Expect | null =>
  e.must_contain.length ||
  e.must_not_contain.length ||
  e.files_exist.length ||
  e.files_not_exist.length ||
  e.file_contains.length ||
  e.exit_code !== null ||
  e.golden_file
    ? e
    : null;
export function resolveSkillConfig(skillDir: string, ref: SkillRef) {
  return {
    source:
      ref.path && !path.isAbsolute(ref.path)
        ? path.join(skillDir, ref.path)
        : ref.path,
    target: ref.target,
    include: [...ref.include],
    exclude: [...ref.exclude],
  };
}
export const toJudgeTurnResults = (
  turns: TurnResult[] = [],
): InputTurnResult[] =>
  turns.map((t) => ({
    turnNumber: t.turnNumber,
    content: t.content,
    response: t.response ?? "",
    transcript: t.transcript ?? [],
    status: t.status,
    reason: t.reason ?? "",
  }));
