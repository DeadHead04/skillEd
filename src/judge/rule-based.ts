// Modified for the skilled TypeScript distribution.
import { regexMatches } from "../regex/index.js";
import { toolCalls, type Transcript } from "../contracts/transcript.js";
import type {
  Rule,
  JudgeConfig,
  OutputContainsRule,
  OutputMatchesRule,
  ToolCalledRule,
  TurnResponseContainsRule,
  TurnResponseNotContainsRule,
  ToolCalledInTurnRule,
  ToolNotCalledInTurnRule,
} from "../contracts/schema.js";
import {
  newResult,
  resolveInput,
  type Judge,
  type Input,
  type InputTurnResult,
  type AssertionResult,
  type Result,
} from "./types.js";
import {
  quote,
  list,
  goFormat,
  fileExistsInWorkspace,
  errorMessage,
} from "./helpers.js";
const assertion = (
  text: string,
  passed: boolean,
  evidence: string,
): AssertionResult => ({ text, passed, evidence });
export class RuleBasedJudge implements Judge {
  success: Rule[];
  failure: Rule[];
  constructor(cfg: Pick<JudgeConfig, "success" | "failure">) {
    this.success = cfg.success;
    this.failure = cfg.failure;
  }
  async evaluate(input: Input): Promise<Result> {
    const i = resolveInput(input),
      assertions: AssertionResult[] = [];
    for (const rule of this.failure) {
      const a = await evaluateAssertion(rule, i);
      if (a.passed)
        assertions.push(
          assertion(
            "failure: " + a.text,
            false,
            "failure rule matched: " + a.evidence,
          ),
        );
    }
    if (assertions.length)
      return newResult(assertions, i.turnsExecuted, i.turnsTotal);
    for (const rule of this.success)
      assertions.push(await evaluateAssertion(rule, i));
    return newResult(assertions, i.turnsExecuted, i.turnsTotal);
  }
}
export const newRuleBasedJudge = (cfg: JudgeConfig) => new RuleBasedJudge(cfg);
export async function evaluateAssertion(
  rule: Rule,
  input: Input,
): Promise<AssertionResult> {
  const i = resolveInput(input);
  if (rule.output_contains)
    return evalOutputContains(rule.output_contains, i.finalMessage);
  if (rule.output_matches)
    return evalOutputMatches(rule.output_matches, i.finalMessage);
  if (rule.exit_code !== null) return evalExitCode(rule.exit_code, i.exitCode);
  if (rule.tool_called) return evalToolCalled(rule.tool_called, i.transcript);
  if (rule.files_exist.length)
    return evalFilesExist(rule.files_exist, i.workspacePath);
  if (rule.files_not_exist.length)
    return evalFilesNotExist(rule.files_not_exist, i.workspacePath);
  if (rule.turn_response_contains)
    return evalTurnResponseContains(rule.turn_response_contains, i.turnResults);
  if (rule.turn_response_not_contains)
    return evalTurnResponseNotContains(
      rule.turn_response_not_contains,
      i.turnResults,
    );
  if (rule.tool_called_in_turn)
    return evalToolCalledInTurn(rule.tool_called_in_turn, i.turnResults);
  if (rule.tool_not_called_in_turn)
    return evalToolNotCalledInTurn(rule.tool_not_called_in_turn, i.turnResults);
  return assertion(
    "unknown_rule",
    false,
    "no recognizable rule field set in assertion",
  );
}
export function evalOutputContains(
  rule: OutputContainsRule,
  text: string,
): AssertionResult {
  const missing = rule.all.filter((w) => !text.includes(w));
  if (missing.length)
    return assertion(
      `output_contains.all: missing ${list(missing)}`,
      false,
      `output does not contain required keywords: ${list(missing)}`,
    );
  if (rule.any.length && !rule.any.some((w) => text.includes(w)))
    return assertion(
      `output_contains.any: ${list(rule.any)}`,
      false,
      `output does not contain any of ${list(rule.any)}`,
    );
  for (const word of rule.not)
    if (text.includes(word))
      return assertion(
        `output_contains.not: ${quote(word)}`,
        false,
        `output contains forbidden keyword ${quote(word)}`,
      );
  const parts = ruleDescription(rule);
  return assertion(
    parts ? `output_contains{${parts}}` : "output_contains",
    true,
    `output satisfies all contains checks (${parts})`,
  );
}
function ruleDescription(rule: OutputContainsRule): string {
  return (["all", "any", "not"] as const)
    .filter((k) => rule[k].length)
    .map((k) => k + ":" + list(rule[k]))
    .join(", ");
}
export function invalidRegexResult(
  field: string,
  pattern: string,
  error: unknown,
): AssertionResult {
  return assertion(
    `${field}: invalid ${quote(pattern)}`,
    false,
    `invalid regex pattern ${quote(pattern)}: ${errorMessage(error)}`,
  );
}
export function missingRegexMatches(
  field: string,
  patterns: string[],
  text: string,
): { missing: string[]; invalid?: AssertionResult } {
  const missing: string[] = [];
  for (const p of patterns)
    try {
      if (!regexMatches(p, text)) missing.push(p);
    } catch (e) {
      return { missing: [], invalid: invalidRegexResult(field, p, e) };
    }
  return { missing };
}
export function firstMatchingRegex(
  field: string,
  patterns: string[],
  text: string,
): { pattern: string; matched: boolean; invalid?: AssertionResult } {
  for (const p of patterns)
    try {
      if (regexMatches(p, text)) return { pattern: p, matched: true };
    } catch (e) {
      return {
        pattern: "",
        matched: false,
        invalid: invalidRegexResult(field, p, e),
      };
    }
  return { pattern: "", matched: false };
}
export function anyRegexMatches(
  field: string,
  patterns: string[],
  text: string,
): { found: boolean; invalid?: AssertionResult } {
  const r = firstMatchingRegex(field, patterns, text);
  return { found: r.matched, invalid: r.invalid };
}
export function evalOutputMatches(
  rule: OutputMatchesRule,
  text: string,
): AssertionResult {
  const all = missingRegexMatches("output_matches.all", rule.all, text);
  if (all.invalid) return all.invalid;
  if (all.missing.length)
    return assertion(
      `output_matches.all: missing ${list(all.missing)}`,
      false,
      `output does not match required regex patterns: ${list(all.missing)}`,
    );
  if (rule.any.length) {
    const any = anyRegexMatches("output_matches.any", rule.any, text);
    if (any.invalid) return any.invalid;
    if (!any.found)
      return assertion(
        `output_matches.any: ${list(rule.any)}`,
        false,
        `output does not match any of ${list(rule.any)}`,
      );
  }
  const not = firstMatchingRegex("output_matches.not", rule.not, text);
  if (not.invalid) return not.invalid;
  if (not.matched)
    return assertion(
      `output_matches.not: ${quote(not.pattern)}`,
      false,
      `output matches forbidden regex pattern ${quote(not.pattern)}`,
    );
  const parts = ruleDescription(rule);
  return assertion(
    parts ? `output_matches{${parts}}` : "output_matches",
    true,
    `output satisfies all regex checks (${parts})`,
  );
}
export function evalExitCode(
  expected: number,
  actual: number,
): AssertionResult {
  return assertion(
    `exit_code: ${expected}`,
    actual === expected,
    actual === expected
      ? `exit_code is ${actual} as expected`
      : `expected exit_code ${expected}, got ${actual}`,
  );
}
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, ordered(v)]),
    );
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("unsupported JSON number");
  return value;
}
export function argsMatch(
  expected: Record<string, unknown>,
  actual: Record<string, unknown> | undefined,
): boolean {
  for (const [key, value] of Object.entries(expected)) {
    if (!actual || !Object.hasOwn(actual, key)) return false;
    try {
      if (
        JSON.stringify(ordered(value)) !== JSON.stringify(ordered(actual[key]))
      )
        return false;
    } catch {
      return false;
    }
  }
  return true;
}
export function evalToolCalled(
  rule: ToolCalledRule,
  transcript: Transcript,
): AssertionResult {
  for (const m of toolCalls(transcript)) {
    if (m.tool_call?.name !== rule.name) continue;
    if (!Object.keys(rule.args).length)
      return assertion(
        "tool_called: " + rule.name,
        true,
        `tool ${quote(rule.name)} was called`,
      );
    if (argsMatch(rule.args, m.tool_call.arguments))
      return assertion(
        "tool_called: " + rule.name + " (with args)",
        true,
        `tool ${quote(rule.name)} was called with matching args`,
      );
  }
  return assertion(
    "tool_called: " + rule.name,
    false,
    Object.keys(rule.args).length
      ? `tool ${quote(rule.name)} was not called with matching args ${goFormat(rule.args)}`
      : `tool ${quote(rule.name)} was not called`,
  );
}
async function evalFiles(
  files: string[],
  workspace: string,
  inverse: boolean,
): Promise<AssertionResult> {
  const rule = inverse ? "files_not_exist" : "files_exist";
  for (const f of files)
    try {
      const exists = await fileExistsInWorkspace(workspace, f);
      if (exists === inverse)
        return assertion(
          rule + ": " + f,
          false,
          inverse
            ? `file ${quote(f)} should not exist but does`
            : `expected file ${quote(f)} does not exist`,
        );
    } catch (e) {
      return assertion(
        rule + ": " + f,
        false,
        `invalid path ${quote(f)}: ${errorMessage(e)}`,
      );
    }
  return assertion(
    rule + ": " + list(files),
    true,
    inverse ? "none of the forbidden files exist" : "all required files exist",
  );
}
export const evalFilesExist = (files: string[], workspace: string) =>
  evalFiles(files, workspace, false);
export const evalFilesNotExist = (files: string[], workspace: string) =>
  evalFiles(files, workspace, true);
export function lookupTurn(
  turn: number,
  turns: InputTurnResult[],
  rule: string,
): { turn?: InputTurnResult; failure?: AssertionResult } {
  const found =
    turn >= 1 ? turns.find((t) => t.turnNumber === turn) : undefined;
  if (found) {
    if (found.status !== "completed")
      return {
        failure: assertion(
          `${rule}[turn=${turn}]`,
          false,
          `turn ${turn} has status ${quote(found.status)} (reason: ${found.reason}); assertion requires completed turn`,
        ),
      };
    return { turn: found };
  }
  return {
    failure: assertion(
      `${rule}[turn=${turn}]`,
      false,
      `turn ${turn} does not exist (executed ${turns.length} turns)`,
    ),
  };
}
export function evalTurnResponseContains(
  rule: TurnResponseContainsRule,
  turns: InputTurnResult[],
): AssertionResult {
  const found = lookupTurn(rule.turn, turns, "turn_response_contains");
  if (found.failure) return found.failure;
  const text = found.turn!.response,
    missing = rule.contains_all.filter((w) => !text.includes(w));
  if (missing.length)
    return assertion(
      `turn_response_contains[turn=${rule.turn}].contains_all${list(rule.contains_all)}`,
      false,
      `turn ${rule.turn} response missing required keywords: ${list(missing)} (checked: ${list(rule.contains_all)})`,
    );
  if (
    rule.contains_any.length &&
    !rule.contains_any.some((w) => text.includes(w))
  )
    return assertion(
      `turn_response_contains[turn=${rule.turn}].contains_any${list(rule.contains_any)}`,
      false,
      `turn ${rule.turn} response does not contain any of ${list(rule.contains_any)}`,
    );
  const parts = (["contains_all", "contains_any"] as const)
    .filter((k) => rule[k].length)
    .map((k) => k + ":" + list(rule[k]))
    .join(", ");
  return assertion(
    `turn_response_contains[turn=${rule.turn}]{${parts}}`,
    true,
    `turn ${rule.turn} response contains all required keywords (${parts})`,
  );
}
export function evalTurnResponseNotContains(
  rule: TurnResponseNotContainsRule,
  turns: InputTurnResult[],
): AssertionResult {
  const found = lookupTurn(rule.turn, turns, "turn_response_not_contains");
  if (found.failure) return found.failure;
  const text = `turn_response_not_contains[turn=${rule.turn}]{not:${list(rule.not_contains)}}`;
  for (const w of rule.not_contains)
    if (found.turn!.response.includes(w))
      return assertion(
        text,
        false,
        `turn ${rule.turn} response contains forbidden keyword ${quote(w)} (checked: ${list(rule.not_contains)})`,
      );
  return assertion(
    text,
    true,
    `turn ${rule.turn} response does not contain any of the forbidden keywords ${list(rule.not_contains)}`,
  );
}
export function evalToolCalledInTurn(
  rule: ToolCalledInTurnRule,
  turns: InputTurnResult[],
): AssertionResult {
  const found = lookupTurn(rule.turn, turns, "tool_called_in_turn");
  if (found.failure) return found.failure;
  const text = `tool_called_in_turn[turn=${rule.turn}]: ${rule.name}`;
  for (const m of toolCalls(found.turn!.transcript)) {
    if (m.tool_call?.name !== rule.name) continue;
    if (!Object.keys(rule.args).length)
      return assertion(
        text,
        true,
        `tool ${quote(rule.name)} was called in turn ${rule.turn}`,
      );
    if (argsMatch(rule.args, m.tool_call.arguments))
      return assertion(
        text + " (with args)",
        true,
        `tool ${quote(rule.name)} was called in turn ${rule.turn} with matching args`,
      );
  }
  return assertion(
    text,
    false,
    `tool ${quote(rule.name)} was not called in turn ${rule.turn}` +
      (Object.keys(rule.args).length
        ? ` with matching args ${goFormat(rule.args)}`
        : ""),
  );
}
export function evalToolNotCalledInTurn(
  rule: ToolNotCalledInTurnRule,
  turns: InputTurnResult[],
): AssertionResult {
  const found = lookupTurn(rule.turn, turns, "tool_not_called_in_turn");
  if (found.failure) return found.failure;
  const called = toolCalls(found.turn!.transcript).some(
    (m) => m.tool_call?.name === rule.name,
  );
  return assertion(
    `tool_not_called_in_turn[turn=${rule.turn}]: ${rule.name}`,
    !called,
    called
      ? `tool ${quote(rule.name)} was called in turn ${rule.turn} but should not have been`
      : `tool ${quote(rule.name)} was not called in turn ${rule.turn} as expected`,
  );
}
