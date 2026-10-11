// Modified for the skilled TypeScript distribution.
import { quote } from "./helpers.js";
export interface CriterionResult {
  criterion_id: string;
  passed: boolean | null;
  evidence: string[] | null;
  failures: string[] | null;
}
export const criterionID = (index: number) => `criterion-${index + 1}`;
export function agentJudgeJSONCandidate(output: string): string {
  const trimmed = output.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const end = trimmed.indexOf("\n");
  if (end < 0 || trimmed.slice(3, end).trim().toLowerCase() !== "json")
    throw new Error(
      "agent_judge response must be JSON or a single JSON code fence",
    );
  const remainder = trimmed.slice(end + 1).trim();
  if (!remainder.endsWith("```"))
    throw new Error("agent_judge JSON code fence is not closed");
  return remainder.slice(0, -3).trim();
}
// Scan object keys before JSON.parse, which otherwise discards duplicates.
export function validateAgentJudgeJSONKeys(input: string): void {
  const tokens =
    input.match(
      /"(?:[^"\\]|\\.)*"|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]:,]/gs,
    ) ?? [];
  let at = 0;
  const scan = (context: "any" | "response" | "results" | "result"): void => {
    const token = tokens[at++];
    if (token === "{") {
      const keys = new Set<string>();
      while (tokens[at] !== "}") {
        const key = JSON.parse(tokens[at++]);
        if (keys.has(key))
          throw new Error(`duplicate JSON object key ${quote(key)}`);
        keys.add(key);
        let next: "any" | "results" = "any";
        if (context === "response") {
          if (key !== "results")
            throw new Error(
              `JSON object key ${quote(key)} is not allowed in the agent_judge contract`,
            );
          next = "results";
        }
        if (
          context === "result" &&
          !["criterion_id", "passed", "evidence", "failures"].includes(key)
        )
          throw new Error(
            `JSON object key ${quote(key)} is not allowed in the agent_judge contract`,
          );
        at++;
        scan(next);
        if (tokens[at] !== ",") break;
        at++;
      }
      at++;
    } else if (token === "[") {
      while (tokens[at] !== "]") {
        scan(context === "results" ? "result" : "any");
        if (tokens[at] !== ",") break;
        at++;
      }
      at++;
    }
  };
  scan("response");
}
export function decodeAgentJudgeResponse(output: string): {
  results: CriterionResult[] | null;
} {
  const candidate = agentJudgeJSONCandidate(output);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
    validateAgentJudgeJSONKeys(candidate);
    if (parsed === null) return { results: null };
    if (typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("response must be an object");
    const results = (parsed as { results?: unknown }).results;
    if (results == null) return { results: null };
    if (!Array.isArray(results)) throw new Error("results must be an array");
    return {
      results: results.map((value) => {
        if (value === null) value = {};
        if (typeof value !== "object" || Array.isArray(value))
          throw new Error("criterion result must be an object");
        const r = value as Record<string, unknown>;
        if (r.criterion_id != null && typeof r.criterion_id !== "string")
          throw new Error("criterion_id must be a string");
        if (r.passed != null && typeof r.passed !== "boolean")
          throw new Error("passed must be a boolean");
        for (const key of ["evidence", "failures"])
          if (
            r[key] != null &&
            (!Array.isArray(r[key]) ||
              (r[key] as unknown[]).some(
                (v) => v !== null && typeof v !== "string",
              ))
          )
            throw new Error(key + " must be a string array");
        return {
          criterion_id: (r.criterion_id as string) ?? "",
          passed: (r.passed as boolean) ?? null,
          evidence:
            r.evidence == null
              ? null
              : (r.evidence as (string | null)[]).map((v) => v ?? ""),
          failures:
            r.failures == null
              ? null
              : (r.failures as (string | null)[]).map((v) => v ?? ""),
        };
      }),
    };
  } catch (e) {
    throw new Error("invalid JSON response: " + (e as Error).message, {
      cause: e,
    });
  }
}
export function parseAgentJudgeResults(
  criteria: string[],
  output: string,
): CriterionResult[] {
  let decoded;
  try {
    decoded = decodeAgentJudgeResponse(output);
  } catch (e) {
    throw new Error(
      `agent_judge failed to parse agent output: ${(e as Error).message}`,
      { cause: e },
    );
  }
  return validateAgentJudgeResponse(criteria, decoded.results);
}
export function validateAgentJudgeResponse(
  criteria: string[],
  results: CriterionResult[] | null,
): CriterionResult[] {
  if (results === null)
    throw new Error("agent_judge: results is required and must be an array");
  if (results.length !== criteria.length)
    throw new Error(
      `agent_judge: expected ${criteria.length} criterion results, got ${results.length}`,
    );
  const expected = new Map(criteria.map((_, i) => [criterionID(i), i])),
    seen = new Set<string>(),
    ordered: CriterionResult[] = [];
  for (const [i, r] of results.entries()) {
    if (!r.criterion_id.trim())
      throw new Error(`agent_judge: result ${i + 1} is missing criterion_id`);
    const position = expected.get(r.criterion_id);
    if (position === undefined)
      throw new Error(
        `agent_judge: result ${i + 1} has unknown criterion_id ${quote(r.criterion_id)}`,
      );
    if (seen.has(r.criterion_id))
      throw new Error(
        `agent_judge: duplicate criterion_id ${quote(r.criterion_id)}`,
      );
    seen.add(r.criterion_id);
    ordered[position] = validateCriterionResultFields(r);
  }
  for (const id of expected.keys())
    if (!seen.has(id))
      throw new Error(`agent_judge: missing criterion_id ${quote(id)}`);
  return ordered;
}
export function validateCriterionResultFields(
  r: CriterionResult,
): CriterionResult {
  const prefix = `agent_judge: criterion ${quote(r.criterion_id)}`;
  if (r.passed === null) throw new Error(prefix + " is missing passed");
  if (r.evidence === null) throw new Error(prefix + " is missing evidence");
  if (!r.evidence.length) throw new Error(prefix + " has empty evidence");
  r.evidence = r.evidence.map((e, i) => {
    const value = e.trim();
    if (!value) throw new Error(`${prefix} evidence[${i}] is empty`);
    return value;
  });
  if (r.failures === null) throw new Error(prefix + " is missing failures");
  r.failures = r.failures.map((f, i) => {
    const value = f.trim();
    if (!value) throw new Error(`${prefix} failures[${i}] is empty`);
    return value;
  });
  if (r.passed && r.failures.length)
    throw new Error(prefix + " passed but reported failures");
  if (!r.passed && !r.failures.length)
    throw new Error(prefix + " failed but reported no failures");
  return r;
}
export function formatCriterionEvidence(r: CriterionResult): string {
  return (
    (r.evidence ?? []).join("; ") +
    (!r.passed ? " | Failures: " + (r.failures ?? []).join("; ") : "")
  );
}
