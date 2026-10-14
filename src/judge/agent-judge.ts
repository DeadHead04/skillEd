// Modified for the skilled TypeScript distribution.
import { fingerprint, scoringVersion } from "./scoring.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Context } from "@opentelemetry/api";
import type {
  Agent,
  Runtime,
  SessionResult,
  SessionArtifacts,
  ArtifactFile,
  SessionResumer,
} from "../agent/types.js";
import { normalizeSessionResult } from "../agent/types.js";
import { AgentExecutionError } from "../agent/errors.js";
import { combinedSignal, isDeadlineError } from "../agent/custom-support.js";
import type { JudgeContextConfig } from "../contracts/schema.js";
import { warnf, debugf } from "../logging/index.js";
import {
  resolveInput,
  newResult,
  SessionResultError,
  setJudgeSession,
  type Judge,
  type Input,
  type Result,
  type SkillInfo,
  type MaterializedContext,
  type ContextMetadata,
} from "./types.js";
import { materializeJudgeContext } from "./context-materializer.js";
import {
  parseAgentJudgeResults,
  formatCriterionEvidence,
  type CriterionResult,
} from "./agent-response.js";
import {
  buildJudgePrompt,
  buildAgentJudgeCorrectionPrompt,
  buildAgentJudgeFallbackCorrectionPrompt,
} from "./agent-prompt.js";
export * from "./agent-response.js";
export * from "./agent-prompt.js";
export const defaultPassThreshold = 0.7;
export type AgentJudgeCorrectionMode = "independent" | "resumed";
export class AgentJudge implements Judge {
  constructor(
    public agent: Agent,
    public runtime: Runtime | null,
    public model: string,
    public criteria: string[],
    public passThreshold = defaultPassThreshold,
    public context: JudgeContextConfig | null = null,
    public timeoutSeconds = 0,
    public judgeSkills: SkillInfo[] = [],
  ) {}
  async evaluate(
    input: Input,
    signal?: AbortSignal,
    context?: Context,
  ): Promise<Result> {
    const i = resolveInput(input);
    if (!this.criteria.length)
      return newResult([], i.turnsExecuted, i.turnsTotal);
    const bounded = combinedSignal(signal, this.timeoutSeconds * 1000);
    let materialized: MaterializedContext;
    try {
      materialized = await materializeJudgeContext(
        this.runtime,
        this.context,
        i,
        i.artifactDir,
        bounded,
      );
    } catch (e) {
      throw new Error(
        `agent_judge materialize context: ${(e as Error).message}`,
        { cause: e },
      );
    }
    const prompt = buildJudgePrompt(
      this.criteria,
      materialized,
      this.judgeSkills,
    );
    const first = await captureSession(() =>
      this.agent.run(
        this.runtime!,
        { artifactDir: i.artifactDir, signal: bounded, context },
        [{ role: "user", content: prompt, turn: 1 }],
      ),
    );
    const parentExpired = signal?.aborted ?? false;
    await persistAgentJudgeAttemptArtifacts(
      this.runtime,
      i.artifactDir,
      i.artifactDir,
      "raw-response-attempt-1.txt",
      first.session,
      bounded,
    );
    const callError = this.agentCallError(
      bounded,
      first.error,
      first.session,
      parentExpired,
      "agent call",
    );
    if (callError) throw new SessionResultError(callError, first.session);
    let criteria: CriterionResult[], validationError: Error;
    try {
      criteria = parseAgentJudgeResults(
        this.criteria,
        first.session!.final_message ?? "",
      );
      return this.buildResult(
        i,
        first.session!,
        materialized,
        prompt,
        criteria,
      );
    } catch (e) {
      validationError = e as Error;
    }
    if (bounded?.aborted)
      throw new SessionResultError(
        new Error(
          "agent_judge output validation failed and correction retry could not start: " +
            validationError.message +
            "\n" +
            String(bounded.reason),
          { cause: bounded.reason },
        ),
        first.session,
      );
    warnf(
      "agent_judge output failed validation; retrying once with correction guidance: %s",
      validationError.message,
    );
    const correction = buildAgentJudgeCorrectionPrompt(
        this.criteria,
        validationError,
      ),
      retryDir = i.artifactDir ? path.join(i.artifactDir, "retry") : "";
    const retry = await this.runAgentJudgeCorrection(
      first.session,
      prompt,
      correction,
      retryDir,
      bounded,
      context,
    );
    const retryParentExpired = signal?.aborted ?? false;
    await persistAgentJudgeAttemptArtifacts(
      this.runtime,
      retryDir,
      i.artifactDir,
      "raw-response-attempt-2.txt",
      retry.session,
      bounded,
    );
    const aggregate = aggregateAgentJudgeSessions(
      first.session,
      retry.session,
      retry.mode,
    );
    const retryError = this.agentCallError(
      bounded,
      retry.error,
      retry.session,
      retryParentExpired,
      "correction call",
    );
    if (retryError)
      throw new SessionResultError(
        new Error(
          `agent_judge correction retry failed after initial validation error ${JSON.stringify(validationError.message)}: ${retryError.message}`,
          { cause: retryError },
        ),
        aggregate,
      );
    try {
      criteria = parseAgentJudgeResults(
        this.criteria,
        retry.session!.final_message ?? "",
      );
    } catch (e) {
      throw new SessionResultError(
        new Error(
          `agent_judge correction retry remained invalid after initial validation error ${JSON.stringify(validationError.message)}: ${(e as Error).message}`,
          { cause: e },
        ),
        aggregate,
      );
    }
    debugf("agent_judge correction retry produced a valid response");
    return this.buildResult(i, aggregate!, materialized, prompt, criteria);
  }
  agentCallError(
    signal: AbortSignal | undefined,
    error: Error | undefined,
    session: SessionResult | null,
    parentExpired: boolean,
    label: string,
  ): Error | undefined {
    if (!error) return;
    const annotated = parentExpired
      ? error
      : this.annotateTimeoutError(signal, error);
    if (!canRecoverAgentJudgeResult(error, session))
      return new Error(`agent_judge ${label} failed: ${annotated.message}`, {
        cause: annotated,
      });
    warnf(
      "agent_judge recovering output from %s despite agent error: %s (judge.timeout_seconds=%d, parent_ctx_expired=%s)",
      label,
      error.message,
      this.timeoutSeconds,
      parentExpired,
    );
    return;
  }
  annotateTimeoutError(signal: AbortSignal | undefined, error: Error): Error {
    if (this.timeoutSeconds <= 0 || !isDeadlineError(error) || !signal?.aborted)
      return error;
    return new Error(
      `${error.message} (judge timeout ${this.timeoutSeconds}s via judge.timeout_seconds)`,
      { cause: error },
    );
  }
  async runAgentJudgeCorrection(
    first: SessionResult | null,
    original: string,
    correction: string,
    artifactDir: string,
    signal?: AbortSignal,
    context?: Context,
  ): Promise<{
    session: SessionResult | null;
    error?: Error;
    mode: AgentJudgeCorrectionMode;
  }> {
    const opts = { artifactDir, signal, context };
    if ("runTurn" in this.agent && first?.session_id)
      return {
        ...(await captureSession(() =>
          (this.agent as Agent & SessionResumer).runTurn(
            this.runtime!,
            opts,
            { role: "user", content: correction, turn: 2 },
            first.session_id!,
          ),
        )),
        mode: "resumed",
      };
    return {
      ...(await captureSession(() =>
        this.agent.run(this.runtime!, opts, [
          {
            role: "user",
            content: buildAgentJudgeFallbackCorrectionPrompt(
              original,
              first?.final_message ?? "",
              correction,
            ),
            turn: 1,
          },
        ]),
      )),
      mode: "independent",
    };
  }
  buildResult(
    input: Input,
    session: SessionResult,
    materialized: MaterializedContext,
    prompt: string,
    criteria: CriterionResult[],
  ): Result {
    const i = resolveInput(input),
      assertions = criteria.map((r, index) => ({
        text: this.criteria[index],
        passed: r.passed!,
        evidence: formatCriterionEvidence(r),
      })),
      result = newResult(assertions, i.turnsExecuted, i.turnsTotal);
    result.scoring_version = scoringVersion;
    result.rubric_id = fingerprint({ type: "agent_judge", criteria: this.criteria,
      passThreshold: this.passThreshold, context: this.context, model: this.model,
      observedModel: session.model ?? null, engine: this.agent.name(), skills: this.judgeSkills });
    setJudgeSession(result, session);
    result.judge_context = buildContextMetadata(session, materialized, prompt);
    if (assertions.length)
      result.status =
        result.summary.pass_rate >= this.passThreshold ? "PASS" : "FAIL";
    return result;
  }
}
async function captureSession(
  call: () => Promise<SessionResult>,
): Promise<{ session: SessionResult | null; error?: Error }> {
  try {
    const session = await call();
    return session
      ? { session }
      : { session: null, error: new Error("agent returned no session result") };
  } catch (error) {
    return {
      session: error instanceof AgentExecutionError ? error.result : null,
      error: error as Error,
    };
  }
}
export function newAgentJudge(
  ag: Agent,
  rt: Runtime | null,
  model: string,
  criteria: string[],
  threshold: number | null,
  timeoutSeconds = 0,
  skills: SkillInfo[] = [],
): AgentJudge {
  return newAgentJudgeWithContextAndSkills(
    ag,
    rt,
    model,
    criteria,
    threshold,
    null,
    timeoutSeconds,
    skills,
  );
}
export function newAgentJudgeWithContext(
  ag: Agent,
  rt: Runtime | null,
  model: string,
  criteria: string[],
  threshold: number | null,
  cfg: JudgeContextConfig | null,
  timeoutSeconds = 0,
): AgentJudge {
  return newAgentJudgeWithContextAndSkills(
    ag,
    rt,
    model,
    criteria,
    threshold,
    cfg,
    timeoutSeconds,
  );
}
export function newAgentJudgeWithContextAndSkills(
  ag: Agent,
  rt: Runtime | null,
  model: string,
  criteria: string[],
  threshold: number | null,
  cfg: JudgeContextConfig | null,
  timeoutSeconds = 0,
  skills: SkillInfo[] = [],
): AgentJudge {
  return new AgentJudge(
    ag,
    rt,
    model,
    criteria,
    threshold ?? defaultPassThreshold,
    cfg,
    timeoutSeconds,
    skills,
  );
}
export function canRecoverAgentJudgeResult(
  error: Error | undefined,
  session: SessionResult | null,
): boolean {
  if (!error || !session?.final_message?.trim()) return false;
  for (let e: unknown = error; e instanceof Error; e = e.cause)
    if (e.name === "AbortError") return false;
  return true;
}
export async function persistAgentJudgeAttemptArtifacts(
  rt: Runtime | null,
  attemptDir: string,
  rawDir: string,
  fileName: string,
  session: SessionResult | null,
  signal?: AbortSignal,
): Promise<void> {
  await snapshotAgentJudgeAttemptArtifacts(rt, attemptDir, session, signal);
  await persistAgentJudgeRawResponse(rawDir, fileName, session);
}
export async function persistAgentJudgeRawResponse(
  dir: string,
  name: string,
  session: SessionResult | null,
): Promise<void> {
  if (!dir || !session) return;
  try {
    await mkdir(dir, { recursive: true, mode: 0o755 });
    const file = path.join(dir, name);
    await writeFile(file, session.final_message ?? "", { mode: 0o600 });
    const artifacts = (session.artifacts ??= {});
    artifacts.generated_files = appendUniqueString(
      artifacts.generated_files ?? [],
      file,
    );
  } catch (e) {
    warnf(
      "agent_judge failed to persist raw response artifact %s: %s",
      dir,
      String(e),
    );
  }
}
export async function snapshotAgentJudgeAttemptArtifacts(
  rt: Runtime | null,
  dir: string,
  session: SessionResult | null,
  signal?: AbortSignal,
): Promise<void> {
  if (!dir || !session?.artifacts) return;
  try {
    await mkdir(dir, { recursive: true, mode: 0o755 });
  } catch (e) {
    warnf(
      "agent_judge failed to create attempt artifact directory %s: %s",
      dir,
      String(e),
    );
    return;
  }
  const files = [...(session.artifacts.generated_files ?? [])];
  for (const [i, source] of files.entries()) {
    if (!source || pathWithinDir(source, dir)) continue;
    const target = path.join(dir, path.basename(source));
    try {
      if (!rt) throw new Error("runtime is unavailable");
      await rt.downloadFile(source, target, signal);
      files[i] = target;
    } catch (e) {
      warnf(
        "agent_judge failed to snapshot attempt artifact %s to %s: %s",
        source,
        target,
        String(e),
      );
    }
  }
  session.artifacts.generated_files = appendUniqueStrings(files);
}
export function pathWithinDir(file: string, dir: string): boolean {
  const clean = path.normalize(file),
    root = path.normalize(dir);
  if (!path.isAbsolute(clean) || !path.isAbsolute(root)) return false;
  const rel = path.relative(root, clean);
  return !!rel && rel !== ".." && !rel.startsWith(".." + path.sep);
}
export function aggregateAgentJudgeSessions(
  first: SessionResult | null,
  second: SessionResult | null,
  mode: AgentJudgeCorrectionMode,
): SessionResult | null {
  if (!first) return second;
  if (!second) return first;
  const aggregate = {
      ...second,
      duration_ms: first.duration_ms + second.duration_ms,
    },
    cumulative =
      mode === "resumed" && judgeSessionMetricsAreCumulative(first, second);
  for (const key of ["input_tokens", "output_tokens", "turns"] as const)
    aggregate[key] = cumulative
      ? Math.max(first[key] ?? 0, second[key] ?? 0)
      : (first[key] ?? 0) + (second[key] ?? 0);
  aggregate.artifacts = mergeAgentJudgeSessionArtifacts(
    first.artifacts ?? null,
    second.artifacts ?? null,
  );
  if (first.prompt_delivery) aggregate.prompt_delivery = first.prompt_delivery;
  return normalizeSessionResult(aggregate);
}
export function judgeSessionMetricsAreCumulative(
  first: SessionResult,
  second: SessionResult,
): boolean {
  if (
    !first.transcript?.length ||
    (second.transcript?.length ?? 0) < first.transcript.length
  )
    return false;
  return first.transcript.every((m, i) =>
    isDeepStrictEqual(m, second.transcript![i]),
  );
}
export function mergeAgentJudgeSessionArtifacts(
  first: SessionArtifacts | null,
  second: SessionArtifacts | null,
): SessionArtifacts | null {
  if (!first) return second;
  if (!second) return first;
  const merged = { ...second };
  if (second.generated_file_sources)
    Object.defineProperty(merged, "generated_file_sources", {
      value: second.generated_file_sources,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  merged.workspace_diff ||= first.workspace_diff;
  merged.generated_files = appendUniqueStrings(
    first.generated_files ?? [],
    second.generated_files ?? [],
  );
  merged.files = appendUniqueArtifactFiles(
    first.files ?? [],
    second.files ?? [],
  );
  if (first.logs && !merged.logs) merged.logs = first.logs;
  else if (first.logs && merged.logs !== first.logs)
    merged.logs = first.logs + "\n" + merged.logs;
  return merged;
}
export const appendUniqueStrings = (...groups: string[][]): string[] => [
  ...new Set(groups.flat()),
];
export const appendUniqueString = (
  values: string[],
  value: string,
): string[] => (values.includes(value) ? values : [...values, value]);
export function appendUniqueArtifactFiles(
  ...groups: ArtifactFile[][]
): ArtifactFile[] {
  const seen = new Set<string>();
  return groups.flat().filter((file) => {
    const key = JSON.stringify(
      ["name", "path", "url", "content", "content_base64", "content_type"].map(
        (k) => (file as unknown as Record<string, string>)[k] ?? "",
      ),
    );
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function buildContextMetadata(
  session: SessionResult | null,
  materialized: MaterializedContext,
  prompt: string,
): ContextMetadata {
  return {
    profile: materialized.manifest.profile,
    materialized_dir: materialized.manifest.materialized_dir,
    manifest: materialized.manifest,
    prompt_bytes:
      session?.prompt_delivery?.prompt_bytes ?? Buffer.byteLength(prompt),
    ...(session?.prompt_delivery?.mode
      ? { prompt_delivery: session.prompt_delivery.mode }
      : {}),
  };
}
