// Modified for the skilled TypeScript distribution.
import type { Input, Reporter, CaseResult } from "./reporter.js";
import { newInput, newCaseResult, zeroTime } from "./reporter.js";
import { goJSON, writeToOutput } from "./helpers.js";
export const compact = (
  value: Record<string, unknown>,
  optional: string[],
): Record<string, unknown> => {
  const out = { ...value };
  for (const key of optional) {
    const v = out[key];
    if (
      v == null ||
      v === "" ||
      v === 0 ||
      (Array.isArray(v) && v.length === 0)
    )
      delete out[key];
  }
  return out;
};
export function serializeCaseResult(cr: CaseResult): Record<string, unknown> {
  const c = newCaseResult(cr);
  if (c.turn_results)
    c.turn_results = c.turn_results.map(
      (t) =>
        compact(t as unknown as Record<string, unknown>, [
          "source",
          "reason",
          "stop_reason",
        ]) as unknown as typeof t,
    );
  if (c.judge_skills)
    c.judge_skills = c.judge_skills.map((s) =>
      compact(s as Record<string, unknown>, [
        "source",
        "path",
        "target",
        "include",
        "exclude",
        "name",
      ]),
    );
  if (c.judge_results)
    c.judge_results = c.judge_results.map(
      (o) =>
        compact(o as unknown as Record<string, unknown>, [
          "result",
          "error",
          "skip_reason",
          "artifacts_dir",
          "judge_skills",
        ]) as unknown as typeof o,
    );
  return compact(c as unknown as Record<string, unknown>, [
    "judge_duration_ms",
    "judge_input_tokens",
    "judge_output_tokens",
    "error",
    "gates",
    "judge_results",
    "judge_skills",
    "configuration",
    "prompt",
    "response",
    "observed_model",
    "observed_version",
    "turn_results",
  ]);
}
export function serializeInput(input: Input): Record<string, unknown> {
  const value = newInput(input);
  for (const key of [
    "requested_configuration",
    "applied_configuration",
    "observed_configuration",
  ] as const) {
    const config = value[key];
    if (config)
      value[key] = compact(config as Record<string, unknown>, [
        "role",
        "engine",
        "protocol",
        "provider",
        "model",
        "version",
      ]);
  }
  return compact(
    {
      ...value,
      start_time:
        value.start_time instanceof Date
          ? value.start_time.toISOString().replace(/\.000Z$/, "Z")
          : value.start_time || zeroTime,
      end_time:
        value.end_time instanceof Date
          ? value.end_time.toISOString().replace(/\.000Z$/, "Z")
          : value.end_time || zeroTime,
      case_results: value.case_results?.map(serializeCaseResult) ?? null,
      overall_tokens: value.total_tokens + value.judge_tokens,
    },
    [
      "requested_configuration",
      "applied_configuration",
      "observed_configuration",
      "benchmark",
    ],
  );
}
export function renderJSON(input: Input): string {
  try { return goJSON(serializeInput(input), 2) + "\n"; }
  catch (e) { throw new Error(`json marshal: ${(e as Error).message}`, {cause: e}); }
}
export class JSONReporter implements Reporter {
  constructor(public outputPath = "") {}
  async write(input: Input, _signal?: AbortSignal): Promise<void> {
    await writeToOutput(this.outputPath, "json report", renderJSON(input));
  }
}
