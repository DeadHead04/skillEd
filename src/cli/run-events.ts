// Modified for the skilled TypeScript distribution.
import { lstat, stat, realpath } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import type { Context } from "@opentelemetry/api";
import type { CliContext } from "./context.js";
import type { CaseConfig, EvalConfig, Loader } from "../config/index.js";
import type { ResolvedAgentConfig } from "../credentials/index.js";
import { newRunner, type ExecutionPlan } from "../runner/index.js";
import type {
  IterationPlan,
  PlannedTask,
  EvalResult,
  TaskObserver,
} from "../evaluator/index.js";
import {
  JSONLSink,
  Publisher,
  Lifecycle,
  validatePlan,
  validateUserAttributes,
  MAX_SAFE_INTEGER,
  type Plan,
  type Configuration,
  type CaseStatus,
  type RunStatus,
  type RunPhase,
} from "../events/index.js";
import {
  stringArrayFlag,
  changed,
  evaluateOptionsFromFlags,
  loadCredentialsAndAgent,
  uiProgressObserver,
  printRunSummary,
  exitStatusError,
} from "./run.js";
import * as ui from "../ui/index.js";
export interface EvaluationEventOptions {
  enabled: boolean;
  path: string;
  attributes: Record<string, string>;
}
export function evaluationEventOptionsFromFlags(
  cmd: Command,
): EvaluationEventOptions {
  const eventLog = changed(cmd, "eventLog"),
    eventAttr = changed(cmd, "eventAttribute");
  if (eventAttr && !eventLog)
    throw new Error("--event-attribute requires --event-log");
  if (!eventLog) return { enabled: false, path: "", attributes: {} };
  const p = cmd.opts().eventLog as string;
  if (!p) throw new Error("--event-log path must not be empty");
  if (p === "-")
    throw new Error("--event-log does not support stdout; provide a file path");
  return {
    enabled: true,
    path: p,
    attributes: parseEvaluationEventAttributes(
      stringArrayFlag(cmd, "eventAttribute"),
    ),
  };
}
export function parseEvaluationEventAttributes(
  values: string[],
): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const value of values) {
    const split = value.indexOf("="),
      key = split >= 0 ? value.slice(0, split) : "",
      content = value.slice(split + 1);
    if (split < 0 || !key || !content)
      throw new Error(
        `invalid --event-attribute ${JSON.stringify(value)}: expected non-empty key=value`,
      );
    if (Object.hasOwn(attributes, key))
      throw new Error(`duplicate --event-attribute key ${JSON.stringify(key)}`);
    Object.defineProperty(attributes, key, {
      value: content,
      enumerable: true,
    });
  }
  try {
    validateUserAttributes(attributes);
  } catch (e) {
    throw new Error(`invalid --event-attribute: ${(e as Error).message}`, {
      cause: e,
    });
  }
  return attributes;
}
export function joinDistinctErrors(...errors: unknown[]): Error | undefined {
  const unique: Error[] = [];
  const includes = (a: unknown, b: unknown): boolean =>
    a === b ||
    (a instanceof Error &&
      ((a.cause !== undefined && includes(a.cause, b)) ||
        (a instanceof AggregateError && a.errors.some((e) => includes(e, b)))));
  for (const e of errors)
    if (e != null) {
      const error = e instanceof Error ? e : new Error(String(e));
      if (
        !unique.some(
          (other) => includes(other, error) || includes(error, other),
        )
      )
        unique.push(error);
    }
  if (!unique.length) return undefined;
  if (unique.length === 1) return unique[0];
  return new AggregateError(unique, unique.map((e) => e.message).join("\n"));
}
export function eventRunStatus(
  signal?: AbortSignal,
  error?: unknown,
): RunStatus {
  const cancelled = (e: unknown): boolean =>
    e instanceof Error &&
    (["AbortError", "TimeoutError"].includes(e.name) ||
      (e.cause !== undefined && cancelled(e.cause)) ||
      (e instanceof AggregateError && e.errors.some(cancelled)));
  if (signal?.aborted || cancelled(error)) return "CANCELLED";
  return error != null ? "ERROR" : "COMPLETED";
}
export function positiveSafeEventInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SAFE_INTEGER)
    throw new Error(`${name} must be between 1 and ${MAX_SAFE_INTEGER}`);
  return value;
}
export function evaluationEventConfiguration(value: string): Configuration {
  if (value !== "with_skill" && value !== "without_skill")
    throw new Error(`unsupported task configuration ${JSON.stringify(value)}`);
  return value;
}
export function evaluationEventCaseStatus(value: string): CaseStatus {
  if (!["PASS", "FAIL", "ERROR", "SKIP"].includes(value))
    throw new Error(`unsupported case status ${JSON.stringify(value)}`);
  return value as CaseStatus;
}
export function evaluationEventPlan(plan: ExecutionPlan): Plan {
  let count = 0;
  const iterations = plan.taskPlan.iterations.map((iteration) => ({
    number: positiveSafeEventInteger("iteration", iteration.number),
    tasks: iteration.tasks.map((task) => {
      count++;
      if (!task.case)
        throw new Error(`task ${JSON.stringify(task.id)} has no case`);
      if (task.iteration !== iteration.number)
        throw new Error(
          `task ${JSON.stringify(task.id)} iteration ${task.iteration} does not match iteration ${iteration.number}`,
        );
      if (task.globalTotal !== plan.taskPlan.taskTotal)
        throw new Error(
          `task ${JSON.stringify(task.id)} total ${task.globalTotal} does not match plan total ${plan.taskPlan.taskTotal}`,
        );
      try {
        const index = positiveSafeEventInteger("task index", task.globalIndex);
        const configuration = evaluationEventConfiguration(task.configuration);
        return {
          id: task.id,
          iteration: iteration.number,
          caseID: task.case.id,
          configuration,
          index,
          title: task.case.title,
        };
      } catch (e) {
        throw new Error(
          `task ${JSON.stringify(task.id)}: ${(e as Error).message}`,
          { cause: e },
        );
      }
    }),
  }));
  if (count !== plan.taskPlan.taskTotal)
    throw new Error(
      `expanded task count ${count} does not match plan total ${plan.taskPlan.taskTotal}`,
    );
  return { iterations };
}
export async function canonicalEventLogPath(p: string): Promise<string> {
  const absolute = path.resolve(p);
  try {
    await lstat(absolute);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    const parent = path.dirname(absolute);
    let info;
    try {
      info = await stat(parent);
    } catch (error) {
      throw new Error(`parent directory: ${(error as Error).message}`, {
        cause: error,
      });
    }
    if (!info.isDirectory()) throw new Error("parent path is not a directory");
    let resolved;
    try {
      resolved = await realpath(parent);
    } catch (error) {
      throw new Error(`resolve parent directory: ${(error as Error).message}`, {
        cause: error,
      });
    }
    return path.join(resolved, path.basename(absolute));
  }
  const resolved = await realpath(absolute);
  if ((await stat(resolved)).isDirectory())
    throw new Error("path is a directory");
  return path.normalize(resolved);
}
export async function canonicalizePotentialPath(p: string): Promise<string> {
  const absolute = path.resolve(p);
  let current = absolute;
  const missing: string[] = [];
  for (;;) {
    try {
      await lstat(current);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      const parent = path.dirname(current);
      if (parent === current)
        throw new Error(`no existing ancestor for ${JSON.stringify(p)}`);
      missing.push(path.basename(current));
      current = parent;
      continue;
    }
    return path.join(await realpath(current), ...missing.reverse());
  }
}
export async function pathsReferToSameFile(
  left: string,
  right: string,
): Promise<boolean> {
  if (left === right) return true;
  try {
    const [a, b] = await Promise.all([
      stat(left, { bigint: true }),
      stat(right, { bigint: true }),
    ]);
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}
export async function pathWithin(
  parent: string,
  child: string,
): Promise<boolean> {
  try {
    const info = await stat(parent, { bigint: true });
    if (info.isDirectory())
      for (let current = child; ; current = path.dirname(current)) {
        try {
          const item = await stat(current, { bigint: true });
          if (
            item.isDirectory() &&
            item.dev === info.dev &&
            item.ino === info.ino
          )
            return true;
        } catch {}
        if (path.dirname(current) === current) break;
      }
  } catch {}
  const relative = path.relative(parent, child);
  return (
    !path.isAbsolute(relative) &&
    (relative === "" ||
      (relative !== ".." && !relative.startsWith(".." + path.sep)))
  );
}
export async function validateEvaluationEventLogPath(
  p: string,
  plan: ExecutionPlan,
  external: string,
): Promise<string> {
  let canonical: string, workspace: string;
  try {
    canonical = await canonicalEventLogPath(p);
  } catch (e) {
    throw new Error(
      `invalid --event-log path ${JSON.stringify(p)}: ${(e as Error).message}`,
      { cause: e },
    );
  }
  try {
    workspace = await canonicalizePotentialPath(plan.workspaceDir);
  } catch (e) {
    throw new Error(`resolve evaluation workspace: ${(e as Error).message}`, {
      cause: e,
    });
  }
  if (await pathsReferToSameFile(canonical, workspace))
    throw new Error(
      `--event-log path ${JSON.stringify(p)} conflicts with the evaluation workspace`,
    );
  if (external) {
    let resolved;
    try {
      resolved = await canonicalizePotentialPath(external);
    } catch (e) {
      throw new Error(`resolve external workspace: ${(e as Error).message}`, {
        cause: e,
      });
    }
    if (await pathWithin(resolved, canonical))
      throw new Error(
        `--event-log path ${JSON.stringify(p)} resolves inside external --workspace ${JSON.stringify(external)}`,
      );
  }
  for (const iteration of plan.taskPlan.iterations) {
    let directory;
    try {
      directory = await canonicalizePotentialPath(
        path.join(plan.workspaceDir, `iteration-${iteration.number}`),
      );
    } catch (e) {
      throw new Error(
        `resolve iteration ${iteration.number} workspace: ${(e as Error).message}`,
        { cause: e },
      );
    }
    if (await pathWithin(directory, canonical))
      throw new Error(
        `--event-log path ${JSON.stringify(p)} resolves inside scheduled iteration directory ${JSON.stringify(directory)}`,
      );
  }
  return canonical;
}
export class EvaluationEventAdapter implements TaskObserver {
  private pending: Promise<void>[] = [];
  private error?: Error;
  constructor(readonly lifecycle: Lifecycle) {}
  private record(action: () => Promise<void>): void {
    try {
      this.pending.push(
        action().catch((e) => {
          this.error ??= e instanceof Error ? e : new Error(String(e));
        }),
      );
    } catch (e) {
      this.error ??= e instanceof Error ? e : new Error(String(e));
    }
  }
  setPhase(phase: RunPhase): void {
    this.record(() => this.lifecycle.setPhase(phase));
  }
  onIterationStart(_ctx: Context, iteration: IterationPlan): void {
    this.record(() =>
      this.lifecycle.iterationStarted(
        positiveSafeEventInteger("iteration", iteration.number),
      ),
    );
  }
  onIterationComplete(
    _ctx: Context,
    iteration: IterationPlan,
    _results: EvalResult[],
  ): void {
    this.record(() =>
      this.lifecycle.iterationCompleted(
        positiveSafeEventInteger("iteration", iteration.number),
      ),
    );
  }
  onTaskStart(_ctx: Context, task: PlannedTask): void {
    this.record(() => this.lifecycle.caseStarted(task.id));
  }
  onTaskComplete(_ctx: Context, task: PlannedTask, result: EvalResult): void {
    this.record(() =>
      this.lifecycle.caseCompleted(
        task.id,
        evaluationEventCaseStatus(result.status),
        result.grading?.summary.pass_rate,
      ),
    );
  }
  async drain(): Promise<Error | undefined> {
    await Promise.all(this.pending);
    return this.error;
  }
}
export async function startEvaluationEventStream(
  p: string,
  attributes: Record<string, string>,
  plan: Plan,
  engine: string,
  skillName: string,
) {
  try {
    validatePlan(plan);
  } catch (e) {
    throw new Error(`invalid event plan: ${(e as Error).message}`, {
      cause: e,
    });
  }
  try {
    validateUserAttributes(attributes);
  } catch (e) {
    throw new Error(`invalid event attributes: ${(e as Error).message}`, {
      cause: e,
    });
  }
  const sink = await JSONLSink.open(p);
  let publisher: Publisher;
  try {
    publisher = new Publisher(sink, { attributes });
  } catch (e) {
    try {
      await sink.close();
    } catch (close) {
      throw joinDistinctErrors(e, close);
    }
    throw e;
  }
  let lifecycle: Lifecycle;
  try {
    lifecycle = new Lifecycle(publisher, plan);
  } catch (e) {
    try {
      await publisher.close();
    } catch (close) {
      throw joinDistinctErrors(e, close);
    }
    throw e;
  }
  try {
    await lifecycle.start(engine, skillName);
  } catch (e) {
    try {
      await publisher.close();
    } catch (close) {
      throw joinDistinctErrors(close, e);
    }
    throw e;
  }
  const adapter = new EvaluationEventAdapter(lifecycle);
  return {
    adapter,
    async finish(status: RunStatus): Promise<Error | undefined> {
      const observerError = await adapter.drain();
      let finishError: unknown, closeError: unknown;
      try {
        await lifecycle.finish(status);
      } catch (e) {
        finishError = e;
      }
      try {
        await publisher.close();
      } catch (e) {
        closeError = e;
      }
      return joinDistinctErrors(closeError, finishError, observerError);
    },
  };
}
export async function runEvalWithEventLog(
  cmd: Command,
  cases: CaseConfig[],
  cfg: EvalConfig,
  loader: Loader,
  options: EvaluationEventOptions,
  parent: CliContext,
): Promise<void> {
  const controller = new AbortController();
  const interrupted = () => controller.abort(new Error("context canceled"));
  process.on("SIGINT", interrupted);
  process.on("SIGTERM", interrupted);
  const ctx = {
    ...parent,
    signal: parent.signal
      ? AbortSignal.any([parent.signal, controller.signal])
      : controller.signal,
  };
  try {
    const opts = evaluateOptionsFromFlags(cmd);
    if (!opts.formats?.length) opts.formats = cfg.report.formats;
    const plan = await newRunner(
      cfg,
      loader,
      null,
      {} as ResolvedAgentConfig,
    ).buildExecutionPlan(cases, opts);
    let eventPlan: Plan;
    try {
      eventPlan = evaluationEventPlan(plan);
    } catch (e) {
      throw new Error(`build event plan: ${(e as Error).message}`, {
        cause: e,
      });
    }
    const eventPath = await validateEvaluationEventLogPath(
      options.path,
      plan,
      opts.workspaceDir || "",
    );
    const stream = await startEvaluationEventStream(
      eventPath,
      options.attributes,
      eventPlan,
      cfg.engine.name,
      plan.reportName,
    );
    let setup;
    try {
      setup = await loadCredentialsAndAgent(cmd, cfg, ctx);
    } catch (e) {
      throw joinDistinctErrors(
        e,
        await stream.finish(eventRunStatus(ctx.signal, e)),
      );
    }
    stream.adapter.setPhase("executing");
    opts.observer = uiProgressObserver;
    opts.taskObserver = stream.adapter;
    opts.iterationObserver = stream.adapter;
    ui.blank();
    ui.stepf("🚀", "Running evaluation (%d cases)", plan.caseCount);
    let results: EvalResult[] = [],
      error: unknown;
    try {
      results = await newRunner(
        cfg,
        loader,
        setup.resolver,
        setup.runnerConfig,
      ).evaluatePlan(plan, setup.ag, opts, ctx.signal, ctx.context);
    } catch (e) {
      error = new Error(`failed to evaluate cases: ${(e as Error).message}`, {
        cause: e,
      });
    }
    const invocationError = joinDistinctErrors(
      error,
      ctx.signal.aborted ? ctx.signal.reason : undefined,
    );
    const finalError = await stream.finish(
      eventRunStatus(ctx.signal, invocationError),
    );
    if (invocationError) throw joinDistinctErrors(invocationError, finalError);
    printRunSummary(results);
    const resultError = joinDistinctErrors(
      exitStatusError(ctx.stderr, results),
      finalError,
    );
    if (resultError) throw resultError;
  } finally {
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", interrupted);
  }
}
