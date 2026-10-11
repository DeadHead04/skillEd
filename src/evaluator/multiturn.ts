// Modified for the skilled TypeScript distribution.
import * as fs from "node:fs/promises";
import path from "node:path";
import type {
  Agent,
  SessionResult,
  SessionArtifacts,
  SessionResumer,
  ExecOptions,
  Runtime,
  StrictSessionResumer,
  IncrementalSessionResumer,
} from "../agent/types.js";
import { AgentExecutionError } from "../agent/errors.js";
import type { Transcript } from "../contracts/transcript.js";
import type {
  EvalConfig,
  CaseConfig,
  Turn,
  PostCondition,
  CaptureRule,
} from "../contracts/schema.js";
import type { Resolver } from "../credentials/index.js";
import {
  createSimulator,
  type Simulator,
  type Exchange,
} from "../usersimulator/index.js";
import { compileRegex, type GoRegex } from "../regex/index.js";
import { warnf } from "../logging/index.js";
import {
  asError,
  boundedSignal,
  deadlineBySignal,
  caseMaxTurns,
} from "./helpers.js";
import { archiveIncrementalTurnArtifacts } from "./artifacts.js";
import type { TurnResult } from "./types.js";
export interface MultiTurnState {
  capturedVars: Record<string, string>;
  sessionID: string;
  turnResults: TurnResult[];
  transcript: Transcript;
  sessionTranscript: Transcript;
  inputTokens: number;
  outputTokens: number;
  tokenBaseIn: number;
  tokenBaseOut: number;
  durationMs: number;
  artifacts?: SessionArtifacts;
}
export const newMultiTurnState = (): MultiTurnState => ({
  capturedVars: {},
  sessionID: "",
  turnResults: [],
  transcript: [],
  sessionTranscript: [],
  inputTokens: 0,
  outputTokens: 0,
  tokenBaseIn: 0,
  tokenBaseOut: 0,
  durationMs: 0,
});
export interface MultiTurnEnvironment {
  evalCfg: EvalConfig;
  simulator?: Simulator;
  resolver?: Resolver;
}
export interface TurnSessionMeta {
  caseID: string;
  agentName: string;
  turnNum: number;
  totalTurns: number;
  requireSessionID: boolean;
  resultsAreIncremental: boolean;
}
export function sessionResumerCapabilities(agent: Agent): {
  requireSessionID: boolean;
  incrementalResults: boolean;
} {
  return {
    requireSessionID:
      "requiresSessionIDForNextTurn" in agent &&
      (agent as Agent & StrictSessionResumer).requiresSessionIDForNextTurn(),
    incrementalResults:
      "returnsIncrementalSessionResults" in agent &&
      (
        agent as Agent & IncrementalSessionResumer
      ).returnsIncrementalSessionResults(),
  };
}
export function prepareConversation(
  env: MultiTurnEnvironment,
  cfg: CaseConfig,
): {
  turns: Turn[];
  maxTurns: number;
  autonomous: boolean;
  simulator?: Simulator;
} {
  const turns = [...cfg.input.turns],
    autonomous = !turns.length && !!cfg.user_simulator;
  if (autonomous) turns.push(emptyTurn(cfg.input.prompt));
  let maxTurns = caseMaxTurns(env.evalCfg, cfg);
  if (maxTurns <= 0 && autonomous) maxTurns = 10;
  if (maxTurns > 0 && turns.length > maxTurns)
    throw new Error(
      `case requires ${turns.length} turns but max_turns is ${maxTurns}`,
    );
  return {
    turns,
    maxTurns,
    autonomous,
    simulator: cfg.user_simulator
      ? (env.simulator ??
        createSimulator(env.evalCfg.user_simulator, env.resolver))
      : undefined,
  };
}
function emptyTurn(content: string): Turn {
  return {
    role: "user",
    content,
    respond: "",
    post_condition: null,
    capture: [],
    timeout_seconds: 0,
  };
}
export function simulatorHistory(results: TurnResult[]): Exchange[] {
  return results
    .filter((r) => r.status === "completed")
    .map((r) => ({ user: r.content, agent: r.response ?? "" }));
}
export function substituteTemplate(
  content: string,
  vars: Record<string, string>,
): string {
  const missing: string[] = [];
  const result = content.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    if (Object.hasOwn(vars, name)) return vars[name]!;
    missing.push(name);
    return match;
  });
  if (missing.length)
    throw new Error("unresolved template variable(s): " + missing.join(", "));
  return result;
}
export function substituteTurnContent(
  state: MultiTurnState,
  turn: Turn,
  turnNum: number,
): string {
  try {
    return substituteTemplate(turn.content, state.capturedVars);
  } catch (e) {
    state.turnResults.push({
      turnNumber: turnNum,
      content: turn.content,
      status: "error",
      reason: asError(e).message,
    });
    throw new Error(
      `turn ${turnNum} template substitution: ${asError(e).message}`,
      { cause: e },
    );
  }
}
export async function resolveTurnMessage(
  state: MultiTurnState,
  turn: Turn,
  turnNum: number,
  origin: string,
  simulator: Simulator | undefined,
  scenario: CaseConfig["user_simulator"],
  signal?: AbortSignal,
): Promise<{ content: string; source: string }> {
  if (scenario && turnNum > 1 && !state.sessionID)
    throw new Error(
      `turn ${turnNum}: engine returned no session_id; simulator-backed follow-up cannot resume`,
    );
  if (origin === "simulated") return { content: turn.content, source: origin };
  const content = substituteTurnContent(state, turn, turnNum);
  if (!turn.respond) return { content, source: origin };
  const instruction = substituteTurnContent(
    state,
    emptyTurn(turn.respond),
    turnNum,
  );
  if (!simulator || !scenario)
    throw new Error("user simulator is not configured");
  try {
    const decision = await simulator.next(
      scenario.scenario,
      instruction,
      simulatorHistory(state.turnResults),
      "must_reply",
      signal,
    );
    return { content: decision.message ?? "", source: "simulated" };
  } catch (e) {
    throw new Error(`turn ${turnNum} user simulation: ${asError(e).message}`, {
      cause: e,
    });
  }
}
export async function turnScopedExecOptions(
  opts: ExecOptions,
  turnNum: number,
): Promise<ExecOptions> {
  if (!opts.artifactDir) return opts;
  const artifactDir = path.join(opts.artifactDir, `turn-${turnNum}`);
  await fs.mkdir(artifactDir, { recursive: true, mode: 0o755 });
  return { ...opts, artifactDir };
}
export function clampExecTimeoutToContext(opts: ExecOptions): ExecOptions {
  const deadline = opts.signal ? deadlineBySignal.get(opts.signal) : undefined;
  if (deadline === undefined) return opts;
  const remaining =
    Math.max(Math.floor((deadline - Date.now()) / 1000), 1) * 1000;
  return !opts.timeoutMs || remaining < opts.timeoutMs
    ? { ...opts, timeoutMs: remaining }
    : opts;
}
export async function executeSingleTurn(
  resumer: SessionResumer,
  rt: Runtime,
  opts: ExecOptions,
  content: string,
  turnNum: number,
  timeoutSeconds: number,
  sessionID: string,
): Promise<SessionResult> {
  const bounded = boundedSignal(opts.signal, timeoutSeconds * 1000);
  try {
    return await resumer.runTurn(
      rt,
      clampExecTimeoutToContext({ ...opts, signal: bounded.signal }),
      { role: "user", content, turn: turnNum },
      sessionID,
    );
  } finally {
    bounded.cancel();
  }
}
export const buildTurnResult = (
  turnNum: number,
  content: string,
  result?: SessionResult | null,
): TurnResult => ({
  turnNumber: turnNum,
  content,
  sessionResult: result,
  status: "completed",
  response: result?.final_message ?? "",
  transcript: result?.transcript ?? [],
});
export function transcriptHasPrefix(
  current: Transcript,
  prefix: Transcript,
): boolean {
  return (
    prefix.length <= current.length &&
    prefix.every(
      (m, i) =>
        current[i]!.role === m.role &&
        (current[i]!.content ?? "") === (m.content ?? ""),
    )
  );
}
export const stampTurnTranscript = (
  source: Transcript,
  turnNum: number,
): Transcript => source.map((m) => ({ ...m, turn: turnNum }));
export function transcriptForLogicalTurn(
  current: Transcript,
  previous: Transcript,
  turnNum: number,
): { transcript: Transcript; cumulative: boolean } {
  if (!current.length) return { transcript: [], cumulative: false };
  const cumulative =
    !!previous.length &&
    current.length >= previous.length &&
    transcriptHasPrefix(current, previous);
  return {
    transcript: stampTurnTranscript(
      cumulative ? current.slice(previous.length) : current,
      turnNum,
    ),
    cumulative,
  };
}
export function normalizeTurnSessionResult(
  result: SessionResult | null | undefined,
  turnNum: number,
  previous: Transcript,
): { result: SessionResult | null; cumulative: boolean } {
  if (!result) return { result: null, cumulative: false };
  const { transcript, cumulative } = transcriptForLogicalTurn(
      result.transcript ?? [],
      previous,
      turnNum,
    ),
    normalized = { ...result, transcript };
  if (transcript.length) {
    normalized.turns = 1;
    const final = transcript.findLast((m) => m.role === "assistant")?.content;
    if (final) normalized.final_message = final;
  }
  return { result: normalized, cumulative };
}
export function normalizeIncrementalTurnSessionResult(
  result: SessionResult | null | undefined,
  turnNum: number,
): SessionResult | null {
  if (!result) return null;
  const transcript = stampTurnTranscript(result.transcript ?? [], turnNum),
    normalized = { ...result, transcript };
  if (transcript.length) {
    normalized.turns = 1;
    const final = transcript.findLast((m) => m.role === "assistant")?.content;
    if (final) normalized.final_message = final;
  }
  return normalized;
}
export function accumulatePerTurnMetrics(
  state: MultiTurnState,
  result?: SessionResult | null,
): void {
  if (!result) return;
  state.inputTokens += result.input_tokens ?? 0;
  state.outputTokens += result.output_tokens ?? 0;
  state.tokenBaseIn += result.input_tokens ?? 0;
  state.tokenBaseOut += result.output_tokens ?? 0;
  state.durationMs += result.duration_ms;
}
export function accumulateCumulativeMetrics(
  state: MultiTurnState,
  result?: SessionResult | null,
): void {
  if (!result) return;
  state.inputTokens += Math.max(
    (result.input_tokens ?? 0) - state.tokenBaseIn,
    0,
  );
  state.outputTokens += Math.max(
    (result.output_tokens ?? 0) - state.tokenBaseOut,
    0,
  );
  state.tokenBaseIn = Math.max(state.tokenBaseIn, result.input_tokens ?? 0);
  state.tokenBaseOut = Math.max(state.tokenBaseOut, result.output_tokens ?? 0);
  state.durationMs += result.duration_ms;
}
export const joinArtifactText = (existing = "", next = ""): string =>
  existing && next ? existing + "\n" + next : existing || next;
export function mergeTurnArtifacts(
  state: MultiTurnState,
  result?: SessionResult | null,
): void {
  if (!result?.artifacts) return;
  const target = (state.artifacts ??= {}),
    source = result.artifacts;
  target.generated_files = [
    ...(target.generated_files ?? []),
    ...(source.generated_files ?? []),
  ];
  target.generated_file_sources = [
    ...(target.generated_file_sources ?? []),
    ...(source.generated_file_sources ?? []),
  ];
  target.files = [...(target.files ?? []), ...(source.files ?? [])];
  target.workspace_diff = joinArtifactText(
    target.workspace_diff,
    source.workspace_diff,
  );
  target.logs = joinArtifactText(target.logs, source.logs);
}
export function absorbTurnSession(
  state: MultiTurnState,
  result: SessionResult | null | undefined,
  meta: TurnSessionMeta,
): SessionResult | null {
  if (result?.session_id) state.sessionID = result.session_id;
  else if (meta.requireSessionID) state.sessionID = "";
  else if (meta.turnNum < meta.totalTurns)
    warnf(
      "Evaluator: case %s turn %d: agent %s reported no session id; next turn will start a new session",
      meta.caseID,
      meta.turnNum,
      meta.agentName,
    );
  const normalized = meta.resultsAreIncremental
    ? {
        result: normalizeIncrementalTurnSessionResult(result, meta.turnNum),
        cumulative: false,
      }
    : normalizeTurnSessionResult(result, meta.turnNum, state.sessionTranscript);
  state.sessionTranscript = result?.transcript ?? [];
  if (normalized.cumulative)
    accumulateCumulativeMetrics(state, normalized.result);
  else accumulatePerTurnMetrics(state, normalized.result);
  mergeTurnArtifacts(state, normalized.result);
  return normalized.result;
}
export function requiredSessionIDError(
  meta: TurnSessionMeta,
  result: SessionResult | null | undefined,
): Error | undefined {
  if (
    !meta.requireSessionID ||
    meta.turnNum >= meta.totalTurns ||
    result?.session_id
  )
    return;
  return new Error(
    `case ${meta.caseID} turn ${meta.turnNum}: custom stateful engine returned no session_id; turn ${meta.turnNum + 1} cannot resume`,
  );
}
export function evaluatePostCondition(
  pc: PostCondition | null | undefined,
  response: string,
): string {
  if (!pc) return "";
  for (const v of pc.must_contain_all)
    if (!response.includes(v))
      return `must_contain_all: missing ${JSON.stringify(v)}`;
  if (
    pc.must_contain_any.length &&
    !pc.must_contain_any.some((v) => response.includes(v))
  )
    return `must_contain_any: none of [${pc.must_contain_any.join(" ")}] found`;
  for (const v of pc.must_not_contain)
    if (response.includes(v))
      return `must_not_contain: found ${JSON.stringify(v)}`;
  return "";
}
export function handlePostCondition(
  turn: Turn,
  tr: TurnResult,
  index: number,
  turns: Turn[],
  state: MultiTurnState,
): boolean {
  const reason = evaluatePostCondition(turn.post_condition, tr.response ?? "");
  if (!reason) return false;
  tr.status = "failed";
  tr.reason = reason;
  state.turnResults.push(tr);
  if (turn.post_condition?.on_fail === "skip_remaining")
    for (let i = index + 1; i < turns.length; i++)
      state.turnResults.push({
        turnNumber: i + 1,
        content: turns[i]!.content,
        status: "skipped",
        reason: `skipped: turn ${index + 1} post_condition failed`,
      });
  return true;
}
export function countUnnamedGroups(regex: GoRegex): number {
  return regex.subexpNames.slice(1).filter((n) => !n).length;
}
export function extractCaptureValue(
  regex: GoRegex,
  match: (string | undefined)[],
): string {
  const index = regex.subexpNames.indexOf("value");
  if (index >= 0 && index < match.length) return match[index] ?? "";
  const unnamed = countUnnamedGroups(regex);
  if (!unnamed)
    throw new Error(
      "pattern has no capture groups; use (?P<value>...) or a single (...)",
    );
  if (unnamed > 1)
    throw new Error(
      `pattern has ${unnamed} unnamed capture groups; use (?P<value>...) to disambiguate`,
    );
  return match[1] ?? "";
}
export function captureVariableValue(
  rule: CaptureRule,
  response: string,
): string {
  if (rule.pattern) {
    let regex;
    try {
      regex = compileRegex(rule.pattern);
    } catch (e) {
      throw new Error(
        `invalid regex ${JSON.stringify(rule.pattern)}: ${asError(e).message}`,
        { cause: e },
      );
    }
    const match = regex.exec(response);
    if (!match)
      throw new Error(
        `pattern ${JSON.stringify(rule.pattern)} did not match response`,
      );
    return extractCaptureValue(regex, match);
  }
  if (rule.jsonpath) return extractJSONPathValue(response, rule.jsonpath);
  throw new Error("empty extractor");
}
export function captureVariables(
  rules: CaptureRule[],
  response: string,
): Record<string, string> {
  const captured: Record<string, string> = {};
  for (const rule of rules) {
    let value;
    try {
      value = captureVariableValue(rule, response);
    } catch (e) {
      throw new Error(
        `capture variable ${JSON.stringify(rule.variable)}: ${asError(e).message}`,
        { cause: e },
      );
    }
    if (!value)
      throw new Error(
        `capture variable ${JSON.stringify(rule.variable)}: extractor matched but produced empty value`,
      );
    Object.defineProperty(captured, rule.variable, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return captured;
}
export type JSONPathSegment = { key: string } | { index: number | bigint };
export function unquoteJSONPathKey(raw: string): string | undefined {
  if (
    raw.length < 2 ||
    !(raw[0] === "'" || raw[0] === '"') ||
    raw.at(-1) !== raw[0]
  )
    return;
  const inside = raw.slice(1, -1);
  return /['"\[\]]/.test(inside) ? undefined : inside;
}
export function parseSimpleJSONPath(value: string): JSONPathSegment[] {
  if (value === "$") return [];
  if (!value.startsWith("$"))
    throw new Error(`jsonpath ${JSON.stringify(value)} must start with $`);
  const parts: JSONPathSegment[] = [];
  for (let i = 1; i < value.length; ) {
    if (value[i] === ".") {
      const start = ++i;
      while (i < value.length && /[A-Za-z0-9_-]/.test(value[i]!)) i++;
      if (i === start)
        throw new Error(
          `jsonpath ${JSON.stringify(value)} has empty object key`,
        );
      parts.push({ key: value.slice(start, i) });
    } else if (value[i] === "[") {
      const end = value.indexOf("]", i);
      if (end < 0)
        throw new Error(
          `jsonpath ${JSON.stringify(value)} has unterminated bracket`,
        );
      const raw = value.slice(i + 1, end);
      if (!raw)
        throw new Error(`jsonpath ${JSON.stringify(value)} has empty bracket`);
      const key = unquoteJSONPathKey(raw);
      if (key !== undefined) parts.push({ key });
      else {
        if (
          !/^[+-]?\d+$/.test(raw) ||
          BigInt(raw) < -(2n ** 63n) ||
          BigInt(raw) > 2n ** 63n - 1n
        )
          throw new Error(
            `jsonpath ${JSON.stringify(value)} supports only numeric indexes or quoted keys in brackets`,
          );
        parts.push({
          index: Number.isSafeInteger(Number(raw)) ? Number(raw) : BigInt(raw),
        });
      }
      i = end + 1;
    } else
      throw new Error(
        `jsonpath ${JSON.stringify(value)} has unsupported token at ${JSON.stringify(value.slice(i))}`,
      );
  }
  return parts;
}
class JSONNumber {
  constructor(readonly value: string) {}
}
function firstJSON(source: string): string {
  source = source.trimStart();
  let depth = 0,
    quoted = false,
    escape = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') {
        quoted = false;
        if (depth === 0) return source.slice(0, i + 1);
      }
    } else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      if (--depth === 0) return source.slice(0, i + 1);
    } else if (depth === 0) {
      const primitive =
        /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
          source,
        );
      if (primitive) return primitive[0];
    }
  }
  return source;
}
function encodeJSON(value: unknown): string {
  if (value instanceof JSONNumber) return value.value;
  if (Array.isArray(value)) return "[" + value.map(encodeJSON).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            encodeJSON(k) +
            ":" +
            encodeJSON((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}
export function jsonPathValueString(value: unknown): string {
  if (value == null) throw new Error("jsonpath resolved to null");
  return typeof value === "string"
    ? value
    : value instanceof JSONNumber
      ? value.value
      : encodeJSON(value);
}
export function extractJSONPathValue(response: string, query: string): string {
  let current: unknown;
  try {
    const parse = JSON.parse as (
      text: string,
      reviver: (
        key: string,
        value: unknown,
        context: { source?: string },
      ) => unknown,
    ) => unknown;
    current = parse(firstJSON(response), (_k, v, c) =>
      typeof v === "number" ? new JSONNumber(c.source ?? String(v)) : v,
    );
  } catch (e) {
    throw new Error(
      `invalid JSON response for jsonpath ${JSON.stringify(query)}: ${asError(e).message}`,
      { cause: e },
    );
  }
  for (const part of parseSimpleJSONPath(query)) {
    if ("index" in part) {
      if (!Array.isArray(current))
        throw new Error(
          `jsonpath ${JSON.stringify(query)} expected array before [${part.index}]`,
        );
      if (part.index < 0 || part.index >= current.length)
        throw new Error(
          `jsonpath ${JSON.stringify(query)} index [${part.index}] out of range`,
        );
      current = current[Number(part.index)];
    } else {
      if (
        !current ||
        typeof current !== "object" ||
        Array.isArray(current) ||
        current instanceof JSONNumber
      )
        throw new Error(
          `jsonpath ${JSON.stringify(query)} expected object before ${JSON.stringify(part.key)}`,
        );
      if (!Object.hasOwn(current, part.key))
        throw new Error(
          `jsonpath ${JSON.stringify(query)} key ${JSON.stringify(part.key)} not found`,
        );
      current = (current as Record<string, unknown>)[part.key];
    }
  }
  return jsonPathValueString(current);
}
export const countCompletedTurns = (results: TurnResult[]): number =>
  results.filter((r) => r.status === "completed" || r.status === "failed")
    .length;
export const lastCompletedResponse = (results: TurnResult[]): string =>
  results.findLast((r) => r.status === "completed")?.response ?? "";
export function buildAggregateResult(
  state: MultiTurnState,
  last?: SessionResult | null,
): SessionResult {
  const agg: SessionResult = {
    exit_code: 0,
    ...last,
    transcript: state.transcript,
    input_tokens: state.inputTokens,
    output_tokens: state.outputTokens,
    duration_ms: state.durationMs,
    turns: countCompletedTurns(state.turnResults),
  };
  if (state.artifacts) agg.artifacts = state.artifacts;
  if (last) {
    const response = lastCompletedResponse(state.turnResults);
    if (response) agg.final_message = response;
  }
  return agg;
}
export function multiTurnStatus(
  results: TurnResult[],
): "ERROR" | "FAIL" | "SKIP" | "" {
  for (const [i, r] of results.entries()) {
    if (r.status === "error") return "ERROR";
    if (r.status === "failed")
      return results.slice(i + 1).some((t) => t.status === "skipped")
        ? ""
        : "FAIL";
  }
  if (results.every((r) => r.status === "skipped")) return "SKIP";
  return results.some((r) => r.status === "completed") ? "" : "ERROR";
}
export async function executeMultiTurn(
  env: MultiTurnEnvironment,
  rt: Runtime,
  cfg: CaseConfig,
  agent: Agent,
  opts: ExecOptions,
): Promise<{
  turnResults: TurnResult[];
  session: SessionResult | null;
  error?: Error;
}> {
  const state = newMultiTurnState();
  let last: SessionResult | null = null;
  try {
    const { turns, maxTurns, autonomous, simulator } = prepareConversation(
      env,
      cfg,
    );
    if (!("runTurn" in agent))
      throw new Error(
        `agent ${agent.name()} does not implement SessionResumer for multi-turn evaluation`,
      );
    const resumer = agent as Agent & SessionResumer,
      { requireSessionID, incrementalResults } =
        sessionResumerCapabilities(agent);
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i]!,
        turnNum = i + 1,
        { content, source } = await resolveTurnMessage(
          state,
          turn,
          turnNum,
          autonomous && i > 0 ? "simulated" : "fixed",
          simulator,
          cfg.user_simulator,
          opts.signal,
        );
      let turnOpts = opts;
      try {
        if (incrementalResults)
          turnOpts = await turnScopedExecOptions(opts, turnNum);
      } catch (e) {
        state.turnResults.push({
          turnNumber: turnNum,
          content,
          source,
          status: "error",
          reason: asError(e).message,
        });
        throw e;
      }
      let execError: Error | undefined;
      try {
        last = await executeSingleTurn(
          resumer,
          rt,
          turnOpts,
          content,
          turnNum,
          turn.timeout_seconds,
          state.sessionID,
        );
      } catch (e) {
        execError = asError(e);
        last = e instanceof AgentExecutionError ? e.result : null;
      }
      if (incrementalResults)
        await archiveIncrementalTurnArtifacts(
          rt,
          turnOpts.artifactDir,
          last,
          opts.signal,
        );
      const meta: TurnSessionMeta = {
        caseID: cfg.id,
        agentName: agent.name(),
        turnNum,
        totalTurns: turns.length,
        requireSessionID,
        resultsAreIncremental: incrementalResults,
      };
      const normalized = absorbTurnSession(state, last, meta),
        tr = buildTurnResult(turnNum, content, normalized);
      tr.source = source;
      state.transcript.push(...(tr.transcript ?? []));
      if (execError) {
        tr.status = "error";
        tr.reason = execError.message;
        state.turnResults.push(tr);
        throw execError;
      }
      if (handlePostCondition(turn, tr, i, turns, state)) break;
      if (turn.capture.length) {
        try {
          tr.capturedVars = captureVariables(turn.capture, tr.response ?? "");
          Object.defineProperties(
            state.capturedVars,
            Object.getOwnPropertyDescriptors(tr.capturedVars),
          );
        } catch (e) {
          tr.status = "error";
          tr.reason = asError(e).message;
          state.turnResults.push(tr);
          throw e;
        }
      }
      const missing = requiredSessionIDError(meta, normalized);
      if (missing) {
        tr.status = "error";
        tr.reason = missing.message;
        state.turnResults.push(tr);
        throw missing;
      }
      state.turnResults.push(tr);
      if (autonomous) {
        let decision;
        try {
          decision = await simulator!.next(
            cfg.user_simulator!.scenario,
            "Generate the next user message or stop.",
            simulatorHistory(state.turnResults),
            "may_stop",
            opts.signal,
          );
        } catch (e) {
          throw new Error(
            `turn ${turnNum} user simulation: ${asError(e).message}`,
            { cause: e },
          );
        }
        if (decision.action === "stop") {
          tr.stopReason = decision.reason;
          break;
        }
        if (turnNum >= maxTurns)
          throw new Error(`user simulation reached max_turns=${maxTurns}`);
        if (!state.sessionID) {
          const error = new Error(
            `case ${cfg.id} turn ${turnNum}: engine returned no session_id; turn ${turnNum + 1} cannot resume`,
          );
          tr.status = "error";
          tr.reason = error.message;
          throw error;
        }
        turns.push(emptyTurn(decision.message ?? ""));
      }
    }
    return {
      turnResults: state.turnResults,
      session: buildAggregateResult(state, last),
    };
  } catch (e) {
    return {
      turnResults: state.turnResults,
      session: buildAggregateResult(state, last),
      error: asError(e),
    };
  }
}
