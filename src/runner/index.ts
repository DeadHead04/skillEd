// Modified for the skilled TypeScript distribution.
import path from "node:path";
import { lstat, realpath, stat, readdir, rm } from "node:fs/promises";
import {
  context as otelContext,
  trace,
  type Context,
} from "@opentelemetry/api";
import type { Agent } from "../agent/types.js";
import { resolveAdapterConfig } from "../agent/capabilities.js";
import type { EvalConfig, CaseConfig } from "../contracts/schema.js";
import type { Loader } from "../config/loader.js";
import type { Resolver, ResolvedAgentConfig } from "../credentials/index.js";
import {
  newEvaluator,
  buildPlan,
  EvaluationError,
  type EvalResult,
  type IterationPlan,
  type Plan,
  type ProgressObserver,
  type TaskObserver,
  type TurnResult,
} from "../evaluator/index.js";
import { defaultOutcomeAggregator } from "../judge/aggregation.js";
import { tracer } from "../observability/index.js";
import { debugContextf, warnContextf } from "../logging/index.js";
import * as ui from "../ui/index.js";
import * as report from "../report/index.js";
import { goJSON } from "../report/helpers.js";
import { assertBenchmarkIsolation } from "../evaluator/benchmark-isolation.js";

export interface IterationObserver {
  onIterationStart(context: Context, iteration: IterationPlan): void;
  onIterationComplete(
    context: Context,
    iteration: IterationPlan,
    results: EvalResult[],
  ): void;
}
export interface EvaluateOptions {
  deleteWorkspace?: boolean;
  outputDir?: string;
  workspaceDir?: string;
  iteration?: number;
  formats?: string[];
  observer?: ProgressObserver;
  taskObserver?: TaskObserver;
  iterationObserver?: IterationObserver;
}
export interface ExecutionPlan {
  skillDir: string;
  skillName: string;
  reportName: string;
  workspaceDir: string;
  caseCount: number;
  taskPlan: Plan;
}
export class Runner {
  private currentWorkspace?: report.IterationWorkspace;
  constructor(
    private evalCfg: EvalConfig,
    private loader: Loader,
    private resolver?: Resolver | null,
    private runnerConfig?: ResolvedAgentConfig,
  ) {}
  async initWorkspace(
    outputDir: string,
    skillName: string,
    iteration: number,
    signal?: AbortSignal,
    ctx: Context = otelContext.active(),
  ): Promise<void> {
    signal?.throwIfAborted();
    let ws: report.IterationWorkspace;
    try {
      ws = await report.newIterationWorkspace(outputDir, skillName, iteration);
    } catch (e) {
      throw wrapped("failed to create iteration workspace", e);
    }
    signal?.throwIfAborted();
    try {
      await rm(ws.iterationDir(), { recursive: true, force: true });
    } catch (e) {
      throw wrapped("failed to clean iteration workspace", e);
    }
    this.currentWorkspace = ws;
    debugContextf(ctx, "Runner: iteration workspace: %s", ws.iterationDir());
  }
  workspace(): report.IterationWorkspace | undefined {
    return this.currentWorkspace;
  }
  async buildExecutionPlan(
    cases: CaseConfig[],
    opts: EvaluateOptions = {},
  ): Promise<ExecutionPlan> {
    assertBenchmarkIsolation(this.evalCfg, this.evalCfg.benchmark.enabled, opts.workspaceDir);
    const skillDir = this.loader.skillDir,
      cleanDir = path.resolve(skillDir);
    const skillName = path.basename(cleanDir) || path.parse(cleanDir).root;
    const reportName = (await this.loader.skillName()) || skillName;
    const workspaceDir =
      opts.outputDir ||
      path.join(path.dirname(cleanDir), skillName + "-workspace");
    let runCount = opts.iteration ?? 0,
      startIteration = 1;
    if (runCount <= 0) {
      runCount = 1;
      startIteration = await nextIterationNumber(workspaceDir);
    }
    const configurations = ["with_skill"];
    if (this.evalCfg.benchmark.enabled) configurations.push("without_skill");
    return {
      skillDir,
      skillName,
      reportName,
      workspaceDir,
      caseCount: cases.length,
      taskPlan: buildPlan(cases, startIteration, runCount, configurations),
    };
  }
  async evaluate(
    cases: CaseConfig[],
    ag: Agent,
    opts: EvaluateOptions = {},
    signal?: AbortSignal,
    ctx: Context = otelContext.active(),
  ): Promise<EvalResult[]> {
    return this.evaluatePlan(
      await this.buildExecutionPlan(cases, opts),
      ag,
      opts,
      signal,
      ctx,
    );
  }
  async evaluatePlan(
    plan: ExecutionPlan,
    ag: Agent,
    opts: EvaluateOptions = {},
    signal?: AbortSignal,
    ctx: Context = otelContext.active(),
  ): Promise<EvalResult[]> {
    const span = tracer().startSpan("runner.evaluate", {}, ctx);
    ctx = trace.setSpan(ctx, span);
    const allResults: EvalResult[] = [];
    try {
      await validateExternalWorkspaceOutput(plan, opts.workspaceDir ?? "");
      assertBenchmarkIsolation(this.evalCfg,
        this.evalCfg.benchmark.enabled || plan.taskPlan.iterations.some((i) => i.tasks.some((t) => t.configuration === "without_skill")),
        opts.workspaceDir);
      const runCount = plan.taskPlan.iterations.length;
      span.setAttributes({
        "skilled.cases.count": plan.caseCount,
        "skilled.engine": ag.name(),
        "skilled.iteration.start": plan.taskPlan.startIteration,
        "skilled.iteration.count": runCount,
      });
      for (const iteration of plan.taskPlan.iterations) {
        signal?.throwIfAborted();
        const started = new Date(),
          runNumber = iteration.number;
        try {
          await this.initWorkspace(
            plan.workspaceDir,
            plan.skillName,
            runNumber,
            signal,
            ctx,
          );
        } catch (e) {
          throw wrapped(`failed to init workspace for run ${runNumber}`, e);
        }
        opts.iterationObserver?.onIterationStart(ctx, iteration);
        debugContextf(
          ctx,
          "Runner: running %d case(s) with agent %s%s",
          plan.caseCount,
          ag.name(),
          runCount === 1 ? "" : ` (run ${runNumber}/${runCount})`,
        );
        debugContextf(
          ctx,
          "Runner: benchmark=%s concurrency=%d output_dir=%s iteration=%d",
          this.evalCfg.benchmark.enabled,
          this.evalCfg.cases.parallelism,
          plan.workspaceDir,
          runNumber,
        );
        const ev = newEvaluator({
          skillName: plan.reportName,
          skillDir: plan.skillDir,
          evalCfg: this.evalCfg,
          loader: this.loader,
          resolver: this.resolver ?? undefined,
          agent: ag,
          runnerConfig: this.runnerConfig,
          outputDir: this.currentWorkspace!.iterationDir(),
          workspaceDir: opts.workspaceDir,
          concurrency: this.evalCfg.cases.parallelism,
          deleteWorkspace: opts.deleteWorkspace,
          withBaseline: this.evalCfg.benchmark.enabled,
          observer: opts.observer,
          taskObserver: opts.taskObserver,
        });
        const results = await ev.evaluatePlan(iteration.tasks, signal, ctx);
        signal?.throwIfAborted();
        opts.iterationObserver?.onIterationComplete(ctx, iteration, results);
        allResults.push(...results);
        try {
          await this.writeResults(
            results,
            plan.reportName,
            plan.skillDir,
            runNumber,
            opts.formats ?? [],
            started,
            new Date(),
            signal,
            ctx,
          );
        } catch (e) {
          warnContextf(
            ctx,
            "Runner: failed to write results for run %d: %s",
            runNumber,
            message(e),
          );
        }
      }
      if (runCount > 1) printIterationStabilitySummary(allResults);
      return allResults;
    } catch (e) {
      throw new EvaluationError(e, allResults);
    } finally {
      span.end();
    }
  }
  async writeResults(
    results: EvalResult[],
    skillName: string,
    skillPath: string,
    runNumber: number,
    formats: string[],
    startTime: string | Date,
    endTime: string | Date,
    signal?: AbortSignal,
    ctx: Context = otelContext.active(),
  ): Promise<void> {
    const ws = this.currentWorkspace;
    if (!ws)
      throw new Error("workspace not initialized; call InitWorkspace first");
    const caseIDs = indexCaseResults(results);
    await ensureCaseDirs(ws, results, caseIDs);
    const grouped = groupResultsByCase(results);
    const { withSkillRuns, withoutSkillRuns } =
      await this.writeGroupedCaseArtifacts(ws, grouped, caseIDs, runNumber);
    const bm = report.computeAnthropicBenchmark(
      skillName,
      skillPath,
      withSkillRuns,
      withoutSkillRuns,
    );
    try {
      await ws.writeBenchmark(bm);
    } catch (e) {
      throw wrapped("failed to write benchmark.json", e);
    }
    try {
      await ws.writeBenchmarkMD(bm);
    } catch (e) {
      throw wrapped("failed to write benchmark.md", e);
    }
    const input = buildReportInput(
      skillName,
      grouped,
      caseIDs,
      startTime,
      endTime,
      this.evalCfg,
      this.runnerConfig,
    );
    let resultJSON: string;
    try {
      resultJSON = goJSON(report.serializeInput(input), 2);
    } catch (e) {
      throw wrapped("failed to marshal result.json", e);
    }
    try {
      await ws.writeFile("result.json", Buffer.from(resultJSON + "\n"));
    } catch (e) {
      throw wrapped("failed to write result.json", e);
    }
    await writeFormattedReports(ws.iterationDir(), formats, input, signal);
    ui.blank();
    ui.step("📊", "Generating reports...");
    debugContextf(ctx, "Runner: results written to %s", ws.iterationDir());
    ui.statusf("✅", "Reports saved to %s", ws.iterationDir());
  }
  private async writeGroupedCaseArtifacts(
    ws: report.IterationWorkspace,
    grouped: Map<string, CaseResults>,
    caseIDs: string[],
    runNumber: number,
  ) {
    const withSkillRuns: report.BenchmarkRun[] = [],
      withoutSkillRuns: report.BenchmarkRun[] = [];
    for (const id of caseIDs) {
      const cr = grouped.get(id)!;
      for (const [res, configuration, runs] of [
        [cr.withSkill, "with_skill", withSkillRuns],
        [cr.withoutSkill, "without_skill", withoutSkillRuns],
      ] as const) {
        if (!res) continue;
        try {
          await this.writeCaseArtifacts(ws, res, configuration);
        } catch (e) {
          throw wrapped(
            `failed to write ${configuration} artifacts for ${id}`,
            e,
          );
        }
        runs.push(resultToBenchmarkRun(res, runNumber));
      }
    }
    return { withSkillRuns, withoutSkillRuns };
  }
  private async writeCaseArtifacts(
    ws: report.IterationWorkspace,
    res: EvalResult,
    cfgName: string,
  ) {
    await ws.writeResponse(res.caseID, cfgName, responseContent(res));
    if (res.grading)
      await ws.writeGrading(
        res.caseID,
        cfgName,
        report.convertToAnthropicGrading(res.grading),
      );
    if (res.judgeResults?.length)
      await ws.writeEvaluation(res.caseID, cfgName, {
        version: 1,
        gates: res.expectResult,
        judge_results: res.judgeResults,
        aggregation: {
          strategy:
            res.aggregationStrategy || defaultOutcomeAggregator().strategy(),
          status: res.status,
        },
      });
    await ws.writeEvalMeta(res.caseID, {
      eval_id: 0,
      eval_name: res.caseName,
      prompt: res.prompt,
      assertions: res.grading?.assertion_results.length
        ? res.grading.assertion_results.map((a) => a.text)
        : null,
    });
  }
}
export const newRunner = (
  evalCfg: EvalConfig,
  loader: Loader,
  resolver?: Resolver | null,
  runnerConfig?: ResolvedAgentConfig,
): Runner => new Runner(evalCfg, loader, resolver, runnerConfig);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const wrapped = (prefix: string, e: unknown) =>
  new Error(prefix + ": " + message(e), { cause: e });
export async function validateExternalWorkspaceOutput(
  plan: ExecutionPlan,
  externalWorkspace: string,
): Promise<void> {
  if (!externalWorkspace) return;
  let workspacePath: string;
  try {
    workspacePath = await canonicalizePotentialPath(externalWorkspace);
  } catch (e) {
    throw wrapped("resolve external workspace", e);
  }
  for (const iteration of plan.taskPlan.iterations) {
    let iterationPath: string;
    try {
      iterationPath = await canonicalizePotentialPath(
        path.join(plan.workspaceDir, `iteration-${iteration.number}`),
      );
    } catch (e) {
      throw wrapped(
        `resolve report directory for iteration ${iteration.number}`,
        e,
      );
    }
    if (await pathsOverlap(workspacePath, iterationPath))
      throw new Error(
        `report directory for iteration ${iteration.number} overlaps external workspace ${JSON.stringify(externalWorkspace)}; choose an --output-dir outside --workspace`,
      );
  }
}
export async function canonicalizePotentialPath(
  input: string,
): Promise<string> {
  let current = path.resolve(input);
  const missing: string[] = [];
  for (;;) {
    let exists = false;
    try {
      await lstat(current);
      exists = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (exists)
      return path.normalize(
        path.join(await realpath(current), ...missing.reverse()),
      );
    const parent = path.dirname(current);
    if (parent === current)
      throw new Error(`no existing ancestor for ${JSON.stringify(input)}`);
    missing.push(path.basename(current));
    current = parent;
  }
}
export async function pathsOverlap(
  left: string,
  right: string,
): Promise<boolean> {
  return (
    pathContains(left, right) ||
    pathContains(right, left) ||
    (await pathContainsByIdentity(left, right)) ||
    (await pathContainsByIdentity(right, left))
  );
}
export function pathContains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    !path.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(".." + path.sep)
  );
}
export async function pathContainsByIdentity(
  parent: string,
  child: string,
): Promise<boolean> {
  let parentInfo;
  try {
    parentInfo = await stat(parent);
  } catch {
    return false;
  }
  for (let current = path.normalize(child); ; ) {
    try {
      const info = await stat(current);
      if (info.dev === parentInfo.dev && info.ino === parentInfo.ino)
        return true;
    } catch {}
    const next = path.dirname(current);
    if (next === current) return false;
    current = next;
  }
}
export interface StabilityCaseSummary {
  caseID: string;
  trials: number;
  counts: Record<string, number>;
}
export function buildIterationStabilitySummaries(
  results: EvalResult[],
): StabilityCaseSummary[] {
  const byCase = new Map<string, StabilityCaseSummary>();
  for (const result of results) {
    if (result.configuration && result.configuration !== "with_skill") continue;
    let summary = byCase.get(result.caseID);
    if (!summary) {
      summary = {
        caseID: result.caseID,
        trials: 0,
        counts: Object.create(null),
      };
      byCase.set(result.caseID, summary);
    }
    summary.trials++;
    summary.counts[result.status] = (summary.counts[result.status] ?? 0) + 1;
  }
  return [...byCase.values()];
}
export function remainingStatuses(
  counts: Record<string, number>,
  seen: Set<string>,
): string[] {
  return Object.keys(counts)
    .filter((k) => counts[k] !== 0 && !seen.has(k))
    .sort();
}
export function formatIterationStabilitySummary(
  summary: StabilityCaseSummary,
): string {
  const parts = [`${summary.caseID}: ${summary.trials} trials`],
    statuses = ["PASS", "FAIL", "ERROR", "SKIP"];
  for (const s of [
    ...statuses,
    ...remainingStatuses(summary.counts, new Set(statuses)),
  ])
    if (summary.counts[s] > 0) parts.push(`${summary.counts[s]} ${s}`);
  return (
    parts.join(", ") +
    (Object.keys(summary.counts).length > 1 ? " -> flaky" : "")
  );
}
export function printIterationStabilitySummary(results: EvalResult[]): void {
  const summaries = buildIterationStabilitySummaries(results);
  if (!summaries.length) return;
  ui.blank();
  ui.status("INFO", "Iteration stability summary:");
  for (const s of summaries)
    ui.status("", "  " + formatIterationStabilitySummary(s));
}
export interface CaseResults {
  withSkill?: EvalResult;
  withoutSkill?: EvalResult;
}
export function indexCaseResults(results: EvalResult[]): string[] {
  return [...new Set(results.map((r) => r.caseID))];
}
export function hasBaselineConfiguration(results: EvalResult[]): boolean {
  return results.some((r) => r.configuration === "without_skill");
}
export async function ensureCaseDirs(
  ws: report.IterationWorkspace,
  results: EvalResult[],
  caseIDs: string[],
): Promise<void> {
  try {
    if (hasBaselineConfiguration(results))
      await ws.ensureDirsWithBaseline(caseIDs);
    else await ws.ensureDirs(caseIDs);
  } catch (e) {
    throw wrapped("failed to create directories", e);
  }
}
export function groupResultsByCase(
  results: EvalResult[],
): Map<string, CaseResults> {
  const grouped = new Map<string, CaseResults>();
  for (const r of results) {
    const item = grouped.get(r.caseID) ?? {};
    item[r.configuration === "without_skill" ? "withoutSkill" : "withSkill"] =
      r;
    grouped.set(r.caseID, item);
  }
  return grouped;
}
export async function writeFormattedReports(
  iterDir: string,
  formats: string[],
  input: report.Input,
  signal?: AbortSignal,
): Promise<void> {
  for (const format of formats) {
    const reporter =
      format === "json"
        ? new report.JSONReporter(path.join(iterDir, "report.json"))
        : format === "junit"
          ? new report.JUnitReporter(path.join(iterDir, "report.xml"))
          : format === "html"
            ? new report.HTMLReporter(path.join(iterDir, "report.html"))
            : undefined;
    if (reporter)
      try {
        await reporter.write(input, signal);
      } catch (e) {
        throw wrapped(`write ${format} report`, e);
      }
  }
}
export function resultToBenchmarkRun(
  res: EvalResult,
  runNumber: number,
): report.BenchmarkRun {
  return {
    eval_id: 0,
    eval_name: res.caseName,
    configuration: res.configuration,
    run_number: runNumber,
    result: {
      pass_rate: res.grading?.summary.pass_rate ?? 0,
      passed: res.grading?.summary.passed ?? 0,
      failed: res.grading?.summary.failed ?? 0,
      total: res.grading?.summary.total ?? 0,
      time_seconds: res.duration_ms / 1000,
      tokens: (res.input_tokens ?? 0) + (res.output_tokens ?? 0),
      errors: 0,
    },
    expectations: res.grading?.assertion_results.length
      ? res.grading.assertion_results.map((a) => ({
          text: a.text,
        ...(a.skipped ? { skipped: true } : {}),
          passed: a.passed,
          evidence: a.evidence,
        }))
      : null,
  };
}
export function buildReportInput(
  skillName: string,
  grouped: Map<string, CaseResults>,
  caseIDs: string[],
  startTime: string | Date,
  endTime: string | Date,
  evalCfg: EvalConfig,
  resolved?: ResolvedAgentConfig,
): report.Input {
  if (!resolved?.engine)
    resolved = {
      role: "runner",
      engine: evalCfg.engine.name,
      version: evalCfg.engine.version,
      provider: evalCfg.engine.model.provider,
      model: evalCfg.engine.model.name,
      baseURL: evalCfg.engine.model.base_url,
      kwargs: evalCfg.engine.kwargs,
      warnings: [],
      protocol: "",
      appliedVersion: "",
      appliedProvider: "",
      appliedModel: "",
      appliedAPIKey: "",
      appliedBaseURL: "",
      apiKey: "",
      custom: null,
      providerSource: "",
      modelSource: "",
      apiKeySource: "",
      baseURLSource: "",
    };
  resolved = resolveAdapterConfig(resolved, null);
  const input = report.newInput({
    skill_name: skillName,
    schema_version: evalCfg.schema_version,
    engine_name: resolved.engine,
    model_name:
      (resolved.provider && resolved.model ? resolved.provider + "/" : "") +
      resolved.model,
    requested_configuration: {
      role: resolved.role,
      engine: resolved.engine,
      protocol: resolved.protocol,
      provider: resolved.provider,
      model: resolved.model,
      version: resolved.version,
    },
    applied_configuration: {
      role: resolved.role,
      engine: resolved.engine,
      protocol: resolved.protocol,
      provider: resolved.appliedProvider,
      model: resolved.appliedModel,
      version: resolved.appliedVersion,
    },
    start_time: startTime,
    end_time: endTime,
  });
  for (const caseID of caseIDs) {
    const cr = grouped.get(caseID)!;
    for (const result of [cr.withSkill, cr.withoutSkill])
      if (result) {
        const c = evalResultToCaseResult(result);
        (input.case_results ??= []).push(c);
        input.total_tokens += c.input_tokens + c.output_tokens;
        input.judge_tokens +=
          (c.judge_input_tokens ?? 0) + (c.judge_output_tokens ?? 0);
      }
  }
  input.overall_tokens = input.total_tokens + input.judge_tokens;
  input.observed_configuration = observedRunnerConfiguration(grouped, caseIDs);
  return input;
}
export function observedRunnerConfiguration(
  grouped: Map<string, CaseResults>,
  caseIDs: string[],
): report.AgentConfiguration | null {
  const sessions = caseIDs.flatMap((id) => {
    const r = grouped.get(id);
    return [r?.withSkill, r?.withoutSkill].filter((s): s is EvalResult => !!s);
  });
  if (!sessions.length) return null;
  const unanimous = (key: "model" | "version") =>
    sessions.every((s) => !!s[key] && s[key] === sessions[0][key])
      ? sessions[0][key]!
      : "";
  const config = { model: unanimous("model"), version: unanimous("version") };
  return config.model || config.version ? config : null;
}
export function evalResultToCaseResult(res: EvalResult): report.CaseResult {
  const cr = report.newCaseResult({
    case_id: res.caseID,
    title: res.caseName,
    status: res.status,
    duration_ms: res.duration_ms,
    turns: res.turns,
    input_tokens: res.input_tokens ?? 0,
    output_tokens: res.output_tokens ?? 0,
    grading: res.grading ?? null,
    gates: res.expectResult,
    judge_results: res.judgeResults,
    judge_skills: res.judgeSkills,
    configuration: res.configuration,
    prompt: res.prompt,
    response: responseContent(res),
    ...(res.usage_status ? { usage_status: res.usage_status } : {}),
    observed_model: res.model,
    observed_version: res.version,
    turn_results: evalTurnResultsToReport(res.turnResults),
  });
  const session = res.judgeSession ?? res.grading?.judgeSession;
  cr.judge_duration_ms = session?.duration_ms ?? 0;
  cr.judge_input_tokens = session?.input_tokens ?? 0;
  cr.judge_output_tokens = session?.output_tokens ?? 0;
  for (const outcome of res.judgeResults ?? []) {
    cr.judge_duration_ms += outcome.duration_ms;
    cr.judge_input_tokens += outcome.session?.input_tokens ?? 0;
    cr.judge_output_tokens += outcome.session?.output_tokens ?? 0;
  }
  if (res.error) cr.error = res.error.message;
  return cr;
}
export function evalTurnResultsToReport(
  turns?: TurnResult[],
): report.CaseTurnResult[] | null {
  return turns?.length
    ? turns.map((t) => ({
        turn_number: t.turnNumber,
        content: t.content,
        source: t.source,
        response: t.response ?? "",
        status: t.status,
        reason: t.reason,
        stop_reason: t.stopReason,
      }))
    : null;
}
export function responseContent(res?: EvalResult | null): string {
  return !res
    ? ""
    : res.final_message ||
        (!res.error && res.exit_code === 0 ? "" : (res.stderr ?? ""));
}
export async function nextIterationNumber(
  workspaceDir: string,
): Promise<number> {
  let entries;
  try {
    entries = await readdir(workspaceDir, { withFileTypes: true });
  } catch {
    return 1;
  }
  let max = 0;
  for (const e of entries) {
    if (!e.isDirectory() || !/^iteration-[1-9]\d*$/.test(e.name)) continue;
    const n = Number(e.name.slice(10));
    if (Number.isSafeInteger(n) && n > max) max = n;
  }
  return max + 1;
}
