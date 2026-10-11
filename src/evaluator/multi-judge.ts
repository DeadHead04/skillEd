// Modified for the skilled TypeScript distribution.
import path from "node:path";
import { realpathSync } from "node:fs";
import type { Context } from "@opentelemetry/api";
import type { Runtime, JudgeSnapshotProvider } from "../runtime/types.js";
import type { Agent } from "../agent/types.js";
import type { CaseConfig, JudgeConfig } from "../contracts/schema.js";
import type { JudgePlan } from "../config/judge-plan.js";
import type { Input, Outcome } from "../judge/types.js";
import { defaultOutcomeAggregator } from "../judge/aggregation.js";
import { normalizeOutcome } from "../judge/types.js";
import { warnf } from "../logging/index.js";
import type { EvalResult } from "./types.js";
import { asError, boundedSignal } from "./helpers.js";
export type JudgeOutcome = Outcome;
export const judgeNeedsWorkspaceDiff = (cfg: JudgeConfig): boolean =>
  cfg.type === "agent_judge";
export const judgePlanNeedsWorkspaceDiff = (plan: JudgePlan): boolean =>
  plan.judges.some(judgeNeedsWorkspaceDiff);
export function recordSkippedJudges(
  result: EvalResult,
  plan: JudgePlan,
  reason: string,
): void {
  if (!plan.multi) return;
  for (const member of plan.judges)
    (result.judgeResults ??= []).push({
      id: member.id,
      type: member.type,
      status: "SKIP",
      skip_reason: reason,
      duration_ms: 0,
    });
}
export function judgeWorkspaceRelativePath(relative: string): boolean {
  return relative !== ".." && !relative.startsWith(".." + path.sep);
}
export function judgeWorkspacePath(
  value: string,
  source: string,
  fork: string,
): string {
  if (!source || !path.isAbsolute(value)) return value;
  const sourceRoot = path.resolve(source);
  let rel = path.relative(sourceRoot, value);
  if (!judgeWorkspaceRelativePath(rel)) {
    try {
      rel = path.relative(realpathSync(sourceRoot), value);
    } catch {
      return value;
    }
  }
  return judgeWorkspaceRelativePath(rel) ? path.join(fork, rel) : value;
}
export function judgeConfigForWorkspace(
  member: JudgeConfig,
  source: string,
  fork: string,
): JudgeConfig {
  if (!member.context || !source) return member;
  return {
    ...member,
    context: {
      ...member.context,
      attachments:
        member.context.attachments?.map((a) => ({
          ...a,
          path: judgeWorkspacePath(a.path, source, fork),
        })) ?? null,
    },
  };
}
export function judgeInputForWorkspace(input: Input, fork: string): Input {
  return {
    ...input,
    workspacePath: fork,
    generatedFiles: input.generatedFiles?.map((file) =>
      judgeWorkspacePath(file, input.workspacePath ?? "", fork),
    ),
  };
}
export const judgeOutcomeError = (graded: EvalResult): string =>
  graded.error?.message || graded.grading?.error_reason || "";
export function summarizeJudgeErrors(outcomes: Outcome[]): string {
  return (
    "judges failed to complete: " +
    outcomes
      .filter((o) => o.status === "ERROR" || o.status === "SKIP")
      .map((o) => o.id + ": " + (o.error || o.skip_reason || ""))
      .join("; ")
  );
}
export function multiJudgeError(
  signal: AbortSignal | undefined,
  outcomes: Outcome[],
  causes: Error[],
): Error {
  const all = [...causes];
  if (signal?.aborted) all.push(asError(signal.reason));
  const summary = summarizeJudgeErrors(outcomes);
  return all.length
    ? new Error(summary + ": " + all.map((e) => e.message).join("\n"), {
        cause: new AggregateError(all),
      })
    : new Error(summary);
}
export interface JudgePhaseRunner {
  prepareOutputDir(
    configuration: string,
    caseID: string,
    subpath: string,
  ): Promise<string>;
  runJudgePhase(
    rt: Runtime,
    cfg: CaseConfig,
    configuration: string,
    judgeCfg: JudgeConfig,
    turnsTotal: number,
    agent: Agent,
    input: Input,
    result: EvalResult,
    artifactRoot: string,
    strictTimeout: boolean,
    signal?: AbortSignal,
    context?: Context,
  ): Promise<EvalResult>;
}
export async function runMultipleJudges(
  e: JudgePhaseRunner,
  rt: Runtime,
  cfg: CaseConfig,
  configuration: string,
  plan: JudgePlan,
  turnsTotal: number,
  agent: Agent,
  input: Input,
  result: EvalResult,
  signal?: AbortSignal,
  ctx?: Context,
): Promise<EvalResult> {
  if (!("captureJudgeSnapshot" in rt)) {
    recordSkippedJudges(result, plan, "unsupported_runtime");
    result.status = "ERROR";
    result.error = new Error(
      `multi-judge workspace isolation is not supported by ${rt.constructor.name}`,
    );
    return result;
  }
  let snapshot;
  try {
    snapshot = await (
      rt as Runtime & JudgeSnapshotProvider
    ).captureJudgeSnapshot(signal);
  } catch (error) {
    result.error = asError(error);
    recordSkippedJudges(result, plan, "snapshot_failed");
    const aggregate = defaultOutcomeAggregator().aggregate(
      result.judgeResults ?? [],
      result.turns,
      turnsTotal,
    );
    result.grading = aggregate.result;
    result.status = aggregate.status;
    return result;
  }
  result.judgeResults = [];
  const causes: Error[] = [];
  try {
    for (const [i, member] of plan.judges.entries()) {
      if (signal?.aborted) {
        for (const pending of plan.judges.slice(i))
          result.judgeResults.push({
            id: pending.id,
            type: pending.type,
            status: "SKIP",
            skip_reason: "case deadline or cancellation",
            duration_ms: 0,
          });
        break;
      }
      const started = Date.now(),
        outcome: Outcome = {
          id: member.id,
          type: member.type,
          status: "ERROR",
          artifacts_dir: "judge/" + member.id + "/run",
          duration_ms: 0,
        };
      await e.prepareOutputDir(configuration, cfg.id, outcome.artifacts_dir!);
      const bounded = boundedSignal(
        signal,
        (member.timeout_seconds ?? 0) * 1000,
      );
      try {
        const fork = await snapshot.fork(bounded.signal);
        try {
          const memberInput = judgeInputForWorkspace(
              input,
              fork.runtime.workspace(),
            ),
            graded = await e.runJudgePhase(
              fork.runtime,
              cfg,
              configuration,
              judgeConfigForWorkspace(
                member,
                input.workspacePath ?? "",
                fork.runtime.workspace(),
              ),
              turnsTotal,
              agent,
              memberInput,
              {
                ...result,
                judgeResults: undefined,
                grading: undefined,
                error: undefined,
              },
              outcome.artifacts_dir!,
              true,
              bounded.signal,
              ctx,
            );
          outcome.status = graded.status;
          outcome.result = graded.grading;
          outcome.session = graded.judgeSession;
          outcome.judge_skills = graded.judgeSkills;
          outcome.error = judgeOutcomeError(graded);
          if (graded.status === "ERROR" && graded.error)
            causes.push(graded.error);
        } finally {
          await fork.cleanup();
        }
      } catch (error) {
        outcome.status = "ERROR";
        outcome.error = asError(error).message;
        causes.push(asError(error));
      }
      if (bounded.signal?.aborted) {
        if (outcome.status !== "ERROR") {
          outcome.status = "ERROR";
          outcome.error = asError(bounded.signal.reason).message;
        }
        causes.push(asError(bounded.signal.reason));
      }
      bounded.cancel();
      outcome.duration_ms = Date.now() - started;
      result.judgeResults.push(normalizeOutcome(outcome));
    }
    const aggregate = defaultOutcomeAggregator().aggregate(
      result.judgeResults,
      result.turns,
      turnsTotal,
    );
    result.grading = aggregate.result;
    result.status = aggregate.status;
    if (result.status === "ERROR")
      result.error = multiJudgeError(signal, result.judgeResults, causes);
    result.configuration = configuration;
    return result;
  } finally {
    try {
      await snapshot.close();
    } catch (error) {
      warnf("close judge snapshot: %s", String(error));
    }
  }
}
