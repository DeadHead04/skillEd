// Modified for the skilled TypeScript distribution.
import path from "node:path";
import {
  context as otelContext,
  trace,
  type Context,
} from "@opentelemetry/api";
import type {
  Agent,
  Runtime,
  SessionResult,
  RuntimeObservation,
  ExecOptions,
} from "../agent/types.js";
import { preflight } from "../agent/base.js";
import { AgentExecutionError } from "../agent/errors.js";
import { detectAgentWithResolvedConfig } from "../agent/factory.js";
import {
  resolveAdapterConfig,
  logAdapterConfig,
} from "../agent/capabilities.js";
import {
  createRuntime,
  type RuntimeConfig,
  type MCPConfig,
} from "../runtime/index.js";
import { quotePOSIX, quoter } from "../platform/index.js";
import type {
  EvalConfig,
  CaseConfig,
  JudgeConfig,
} from "../contracts/schema.js";
import { decode } from "../contracts/decode.js";
import { Loader, toRuntimeConfig } from "../config/loader.js";
import { resolveJudgePlan, mergeCaseMCP } from "../config/judge-plan.js";
import {
  Resolver,
  resolveJudgeConfig,
  type ResolvedAgentConfig,
} from "../credentials/index.js";
import type { Simulator } from "../usersimulator/index.js";
import { Provisioner } from "../mcp/index.js";
import type { Input, Judge } from "../judge/types.js";
import { newResult, newSkipResult, sessionResultFromError } from "../judge/types.js";
import { newJudge, mergeJudgeConfig } from "../judge/factory.js";
import { checkExpect } from "../judge/expect.js";
import { ScriptJudge, JudgeEvaluationError } from "../judge/script.js";
import { skillInfosFromRefs } from "../judge/judge-skill.js";
import { defaultOutcomeAggregator } from "../judge/aggregation.js";
import {
  tracer,
  recordCaseCompleted,
  contextWithAgentAttributes,
  contextWithConfiguredAgentSpanAttributes,
  linkedTraceTopologyEnabled,
  startLinkedRootSpan,
} from "../observability/index.js";
import { warnf } from "../logging/index.js";
import {
  buildPlan,
  configurationWithSkill,
  configurationWithoutSkill,
  type PlannedTask,
} from "./plan.js";
import {
  EvaluationError,
  type EvalOptions,
  type EvalResult,
  type ProgressObserver,
  type TaskObserver,
} from "./types.js";
import { FixtureRegistry } from "./fixtures.js";
import { collectGlobArtifacts } from "./artifacts-collect.js";
import {
  prepareOutputDir,
  prepareWorkspaceArtifacts,
  ensureArtifactsInOutputDir,
  serializeTranscript,
} from "./artifacts.js";
import { executeMultiTurn, multiTurnStatus } from "./multiturn.js";
import {
  judgeNeedsWorkspaceDiff,
  judgePlanNeedsWorkspaceDiff,
  recordSkippedJudges,
  runMultipleJudges,
} from "./multi-judge.js";
import {
  asError,
  withCaseTimeout,
  annotateCaseTimeoutError,
  retryReasonForResult,
  retryAllowed,
  retryBackoffDelay,
  sleepContext,
  casePromptAndTurnsTotal,
  buildCaseMessages,
  caseTimeoutSeconds,
  caseMaxTurns,
  normalizeSessionResult,
  mergeExpectConfig,
  resolveExpectConfig,
  resolveSkillConfig,
  toJudgeTurnResults,
  isTimeoutError,
} from "./helpers.js";
export class DefaultEvaluator {
  readonly skillName: string;
  readonly skillDir: string;
  readonly outputDir: string;
  readonly workspaceDir: string;
  readonly concurrency: number;
  readonly withBaseline: boolean;
  readonly evalCfg: EvalConfig;
  readonly loader?: Loader;
  readonly resolver?: Resolver;
  readonly ag?: Agent;
  readonly runnerConfig?: ResolvedAgentConfig;
  readonly simulator?: Simulator;
  readonly fixtures = new FixtureRegistry();
  readonly deleteWorkspace: boolean;
  readonly observer?: ProgressObserver;
  readonly taskObserver?: TaskObserver;
  private mcpPromise?: Promise<{
    config: MCPConfig;
    runEnv: Record<string, string>;
  }>;
  constructor(opts: EvalOptions) {
    this.skillName = opts.skillName ?? "";
    this.skillDir = opts.skillDir ?? "";
    this.outputDir = opts.outputDir ?? "";
    this.workspaceDir = opts.workspaceDir ?? "";
    this.concurrency = Math.max(1, opts.concurrency ?? 1);
    this.withBaseline = opts.withBaseline ?? false;
    this.evalCfg = opts.evalCfg ?? decode<EvalConfig>("EvalConfig", {});
    this.loader = opts.loader;
    this.resolver = opts.resolver;
    this.ag = opts.agent;
    this.runnerConfig = opts.runnerConfig;
    this.simulator = opts.simulator;
    this.deleteWorkspace = opts.deleteWorkspace ?? false;
    this.observer = opts.observer;
    this.taskObserver = opts.taskObserver;
  }
  async evaluateAll(
    cases: CaseConfig[],
    signal?: AbortSignal,
    ctx: Context = otelContext.active(),
  ): Promise<EvalResult[]> {
    const configs = [configurationWithSkill];
    if (this.withBaseline) configs.push(configurationWithoutSkill);
    return this.evaluatePlan(
      buildPlan(cases, 1, 1, configs).iterations[0]!.tasks,
      signal,
      ctx,
    );
  }
  async evaluatePlan(
    tasks: PlannedTask[],
    signal?: AbortSignal,
    ctx: Context = otelContext.active(),
  ): Promise<EvalResult[]> {
    const span = tracer().startSpan(
      "evaluator.evaluate_all",
      {
        attributes: {
          "skilled.cases.count": tasks.filter(
            (t) => t.configuration === configurationWithSkill,
          ).length,
          "skilled.concurrency": this.concurrency,
          "skilled.baseline.enabled": this.withBaseline,
        },
      },
      ctx,
    );
    ctx = trace.setSpan(ctx, span);
    const results: EvalResult[] = [];
    try {
      signal?.throwIfAborted();
      if (this.ag)
        try {
          await this.ag.checkCredentials(signal);
        } catch (e) {
          throw new Error(
            "agent credential check failed: " + asError(e).message,
            { cause: e },
          );
        }
      let next = 0;
      const worker = async () => {
        while (next < tasks.length && !signal?.aborted) {
          const index = next++,
            task = tasks[index]!,
            num = index + 1;
          this.observer?.onCaseStart(
            num,
            tasks.length,
            task.case.id,
            task.case.title,
          );
          this.taskObserver?.onTaskStart(ctx, task);
          const result = await this.executeCase(
            task.case,
            task.configuration,
            undefined,
            undefined,
            signal,
            ctx,
          );
          results[index] = result;
          this.observer?.onCaseComplete(
            num,
            tasks.length,
            task.case.id,
            result.status,
            result.grading?.summary.pass_rate ?? -1,
          );
          this.taskObserver?.onTaskComplete(ctx, task, result);
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(this.concurrency, tasks.length) },
          worker,
        ),
      );
      if (signal?.aborted) throw new EvaluationError(signal.reason, results);
      return results;
    } catch (e) {
      if (e instanceof EvaluationError) throw e;
      throw new EvaluationError(e, results);
    } finally {
      span.end();
    }
  }
  async executeCase(
    cfg: CaseConfig,
    configuration: string,
    overrideRT?: Runtime,
    overrideAgent?: Agent,
    signal?: AbortSignal,
    ctx: Context = otelContext.active(),
  ): Promise<EvalResult> {
    const maxAttempts = Math.max(
      this.evalCfg.cases.retry_policy.max_retries + 1,
      1,
    );
    let result!: EvalResult;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const bounded = withCaseTimeout(
        signal,
        this.evalCfg.cases.defaults.timeout_seconds,
        cfg.constraints.timeout_seconds,
      );
      try {
        result = await this.executeCaseOnce(
          cfg,
          configuration,
          overrideRT,
          overrideAgent,
          bounded.signal,
          ctx,
        );
        if (
          bounded.signal?.aborted &&
          isTimeoutError(bounded.signal.reason) &&
          !signal?.aborted
        )
          annotateCaseTimeoutError(result, bounded.source, bounded.seconds);
      } finally {
        bounded.cancel();
      }
      const reason = retryReasonForResult(result);
      if (
        !reason ||
        !retryAllowed(this.evalCfg.cases.retry_policy, reason) ||
        attempt === maxAttempts
      )
        return result;
      warnf(
        "Runner: case %s (%s) attempt %d/%d hit %s, retrying after %dms",
        cfg.id,
        configuration,
        attempt,
        maxAttempts,
        reason,
        retryBackoffDelay(attempt),
      );
      try {
        await sleepContext(retryBackoffDelay(attempt), signal);
      } catch {
        return result;
      }
    }
    return result;
  }
  async executeCaseOnce(
    cfg: CaseConfig,
    configuration: string,
    overrideRT?: Runtime,
    overrideAgent?: Agent,
    signal?: AbortSignal,
    ctx: Context = otelContext.active(),
  ): Promise<EvalResult> {
    const start = Date.now(),
      span = tracer().startSpan(
        "evaluator.case",
        {
          attributes: {
            "skilled.case.id": cfg.id,
            "skilled.case.configuration": configuration,
          },
        },
        ctx,
      );
    ctx = contextWithAgentAttributes(trace.setSpan(ctx, span), {
      "skilled.case.id": cfg.id,
      "skilled.case.configuration": configuration,
    });
    const { prompt, turnsTotal } = casePromptAndTurnsTotal(cfg),
      result: EvalResult = {
        caseID: cfg.id,
        caseName: cfg.title,
        configuration,
        prompt,
        turnsTotal,
        status: "ERROR",
        exit_code: 0,
        duration_ms: 0,
        turns: 0,
      };
    let rt: Runtime | undefined,
      owned = false;
    try {
      const agent = overrideAgent ?? this.ag;
      if (!agent) throw new Error("evaluation agent is required");
      let observation: RuntimeObservation;
      if (overrideRT) {
        rt = overrideRT;
        try {
          observation = await preflight(rt, agent, signal);
        } catch (e) {
          throw new Error(
            `agent ${agent.name()} preflight failed: ${asError(e).message}`,
            { cause: e },
          );
        }
      } else {
        const prepared = await this.prepareRuntimeForCase(
          cfg,
          configuration,
          agent,
          signal,
        );
        rt = prepared.runtime;
        observation = prepared.observation;
        owned = true;
      }
      const judgeCfg = mergeJudgeConfig(this.evalCfg.judge, cfg.judge),
        plan = resolveJudgePlan(this.evalCfg, cfg);
      if (plan.multi) {
        result.aggregationStrategy = defaultOutcomeAggregator().strategy();
        if (!("captureJudgeSnapshot" in rt)) {
          recordSkippedJudges(result, plan, "unsupported_runtime");
          throw new Error(
            `multi-judge workspace isolation is not supported by ${rt.constructor.name}`,
          );
        }
      }
      const opts: ExecOptions = {
        artifactDir: await this.prepareOutputDir(
          configuration,
          cfg.id,
          "agent/run",
        ),
        timeoutMs: caseTimeoutSeconds(this.evalCfg, cfg) * 1000,
        agentMetadata: {
          caseID: cfg.id,
          variant: configuration,
          maxTurns: caseMaxTurns(this.evalCfg, cfg),
        },
        signal,
        context: ctx,
      };
      if (cfg.input.turns.length || cfg.user_simulator) {
        if ("runTurn" in agent) {
          const multi = await this.executeMultiTurnCase(
            rt,
            cfg,
            configuration,
            agent,
            opts,
            start,
            judgeCfg,
            result,
            ctx,
          );
          multi.version = observation.version;
          return multi;
        }
        if (cfg.user_simulator) {
          recordSkippedJudges(result, plan, "session_resumption_unsupported");
          throw new Error(
            `agent ${agent.name()} does not support session resumption required by user simulation`,
          );
        }
        warnf(
          "Evaluator: case %s defines input.turns but agent %s does not support session resumption; falling back to a single batch prompt",
          cfg.id,
          agent.name(),
        );
      }
      const artifacts = judgePlanNeedsWorkspaceDiff(plan)
        ? await prepareWorkspaceArtifacts(
            rt,
            cfg.context.git,
            !!this.workspaceDir,
            signal,
          )
        : {
            cleanup: async () => {},
            finalize: async (_r?: SessionResult | null) => {},
          };
      try {
        const agentParent = contextWithConfiguredAgentSpanAttributes(ctx, {}),
          started = startAgentRunSpan(agentParent);
        started.span.setAttributes({
          "skilled.case.id": cfg.id,
          "skilled.case.configuration": configuration,
          "skilled.engine": agent.name(),
        });
        let session: SessionResult | null = null,
          execError: Error | undefined;
        try {
          session = await agent.run(
            rt,
            { ...opts, context: started.context },
            buildCaseMessages(cfg),
          );
        } catch (e) {
          execError = asError(e);
          session = e instanceof AgentExecutionError ? e.result : null;
        } finally {
          started.span.end();
        }
        await artifacts.finalize(session);
        Object.assign(result, normalizeSessionResult(session));
        result.version = observation.version;
        await ensureArtifactsInOutputDir(
          this.outputDir,
          rt,
          configuration,
          cfg.id,
          "agent/run",
          opts.artifactDir ?? "",
          session,
          signal,
        );
        await collectGlobArtifacts(
          this.outputDir,
          this.evalCfg,
          rt,
          configuration,
          cfg,
        );
        if (this.handleExecutionResult(result, start, execError)) {
          recordSkippedJudges(result, plan, "agent_execution_failed");
          return result;
        }
        if (session && session.exit_code !== 0) {
          const expect = mergeExpectConfig(
            this.evalCfg.cases.defaults.expect,
            cfg.expect,
          );
          if (expect.exit_code === null && !judgeCfg.type && !plan.multi) {
            result.duration_ms ||= Date.now() - start;
            result.status = "FAIL";
            return result;
          }
        }
        return await this.evaluateCaseSession(
          rt,
          cfg,
          configuration,
          judgeCfg,
          turnsTotal,
          agent,
          session,
          result,
          signal,
          ctx,
        );
      } finally {
        await artifacts.cleanup();
      }
    } catch (e) {
      result.status = "ERROR";
      result.error = asError(e);
      return result;
    } finally {
      if (rt && owned)
        try {
          await rt.close();
        } catch {}
      recordCaseCompleted(
        ctx,
        this.evalCfg.engine.name,
        result.status || "UNKNOWN",
        result.duration_ms || Date.now() - start,
      );
      span.setAttribute("skilled.case.status", result.status || "UNKNOWN");
      span.end();
    }
  }
  handleExecutionResult(
    result: EvalResult,
    start: number,
    error?: Error,
  ): boolean {
    if (!error) return false;
    result.duration_ms ||= Date.now() - start;
    result.status = "ERROR";
    result.error = new Error("agent execution failed: " + error.message, {
      cause: error,
    });
    return true;
  }
  async executeMultiTurnCase(
    rt: Runtime,
    cfg: CaseConfig,
    configuration: string,
    agent: Agent,
    opts: ExecOptions,
    start: number,
    judgeCfg: JudgeConfig,
    result: EvalResult,
    ctx: Context,
  ): Promise<EvalResult> {
    const plan = resolveJudgePlan(this.evalCfg, cfg),
      artifacts = judgePlanNeedsWorkspaceDiff(plan)
        ? await prepareWorkspaceArtifacts(
            rt,
            cfg.context.git,
            !!this.workspaceDir,
            opts.signal,
          )
        : {
            cleanup: async () => {},
            finalize: async (_r?: SessionResult | null) => {},
          };
    try {
      const executed = await executeMultiTurn(this, rt, cfg, agent, opts);
      result.turnResults = executed.turnResults;
      result.turnsTotal = executed.turnResults.length;
      if (executed.turnResults[0]?.content)
        result.prompt = executed.turnResults[0].content;
      await artifacts.finalize(executed.session);
      Object.assign(result, normalizeSessionResult(executed.session));
      await collectGlobArtifacts(
        this.outputDir,
        this.evalCfg,
        rt,
        configuration,
        cfg,
      );
      if (this.handleExecutionResult(result, start, executed.error)) {
        recordSkippedJudges(result, plan, "agent_execution_failed");
        return result;
      }
      const status = multiTurnStatus(executed.turnResults);
      if (status) {
        result.status = status;
        if (status === "FAIL") result.duration_ms ||= Date.now() - start;
        recordSkippedJudges(
          result,
          plan,
          status === "ERROR"
            ? "turn_error"
            : status === "FAIL"
              ? "post_condition_failed"
              : "turns_skipped",
        );
        return result;
      }
      return await this.evaluateCaseSession(
        rt,
        cfg,
        configuration,
        judgeCfg,
        result.turnsTotal,
        agent,
        executed.session,
        result,
        opts.signal,
        ctx,
      );
    } finally {
      await artifacts.cleanup();
    }
  }
  async evaluateCaseSession(
    rt: Runtime,
    cfg: CaseConfig,
    configuration: string,
    judgeCfg: JudgeConfig,
    turnsTotal: number,
    agent: Agent,
    session: SessionResult | null,
    result: EvalResult,
    signal?: AbortSignal,
    ctx: Context = otelContext.active(),
  ): Promise<EvalResult> {
    const input: Input = {
        caseID: cfg.id,
        finalMessage: result.final_message ?? "",
        exitCode: result.exit_code,
        workspacePath: rt.workspace(),
        skillDir: this.skillDir,
        turnsExecuted: result.turns,
        turnsTotal,
        transcript: session?.transcript ?? [],
        workspaceDiff: session?.artifacts?.workspace_diff ?? "",
        generatedFiles: session?.artifacts?.generated_files ?? [],
        sessionResult: session,
        turnResults: toJudgeTurnResults(result.turnResults),
      },
      plan = resolveJudgePlan(this.evalCfg, cfg);
    if (await this.runExpectPreCheck(cfg, input, turnsTotal, result)) {
      recordSkippedJudges(result, plan, "gate_failed");
      return result;
    }
    const final = plan.multi
      ? await runMultipleJudges(
          this,
          rt,
          cfg,
          configuration,
          plan,
          turnsTotal,
          agent,
          input,
          result,
          signal,
          ctx,
        )
      : await this.runJudgePhase(
          rt,
          cfg,
          configuration,
          judgeCfg,
          turnsTotal,
          agent,
          input,
          result,
          "judge/run",
          false,
          signal,
          ctx,
        );
    return final;
  }
  async runExpectPreCheck(
    cfg: CaseConfig,
    input: Input,
    turnsTotal: number,
    result: EvalResult,
  ): Promise<boolean> {
    const expect = resolveExpectConfig(
      mergeExpectConfig(this.evalCfg.cases.defaults.expect, cfg.expect),
    );
    if (!expect) return false;
    result.expectResult = await checkExpect(expect, input);
    if (result.expectResult.passed) return false;
    // Gates determine whether judging runs; they are not rubric assertions.
    // Keep diagnostics in expectResult and award no benchmark credit for an
    // unexecuted judge, including scripts whose assertion count is dynamic.
    result.grading = newSkipResult(
      "expect_gate_failed",
      result.turns,
      turnsTotal,
    );
    result.status = "FAIL";
    return true;
  }
  async runJudgePhase(
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
    ctx: Context = otelContext.active(),
  ): Promise<EvalResult> {
    const started =
      linkedTraceTopologyEnabled() && judgeNeedsWorkspaceDiff(judgeCfg)
        ? startLinkedRootSpan(
            contextWithConfiguredAgentSpanAttributes(ctx, {}),
            "evaluator.judge",
          )
        : (() => {
            const span = tracer().startSpan("evaluator.judge", {}, ctx);
            return { span, context: trace.setSpan(ctx, span) };
          })();
    ctx = started.context;
    started.span.setAttributes({
      "skilled.case.id": cfg.id,
      "skilled.judge.type": judgeCfg.type,
    });
    let cleanup = async () => {};
    try {
      if (judgeCfg.type === "agent_judge")
        result.judgeSkills = skillInfosFromRefs(judgeCfg.skills);
      let judge: Judge | null;
      try {
        judge = await this.newJudgeForCase(
          rt,
          configuration,
          judgeCfg,
          agent,
          signal,
        );
      } catch (e) {
        result.status = "ERROR";
        result.error = asError(e);
        return result;
      }
      if (!judge) {
        result.status = "PASS";
        result.grading = newResult([], result.turns, turnsTotal);
        return result;
      }
      if (judgeCfg.type === "agent_judge") {
        input.artifactDir = await this.prepareOutputDir(
          configuration,
          cfg.id,
          artifactRoot,
        );
        input.contextArtifactDir = path
          .join(path.dirname(artifactRoot), "context")
          .split(path.sep)
          .join("/");
      }
      if (judge instanceof ScriptJudge) {
        judge.timeoutIsError = strictTimeout;
        if (input.transcript?.length)
          try {
            const serialized = await serializeTranscript(input.transcript);
            judge.transcriptPath = serialized.path;
            cleanup = serialized.cleanup;
          } catch (e) {
            warnf(
              "Evaluator: failed to serialize transcript for script judge: %s",
              String(e),
            );
          }
      }
      try {
        const grading = await judge.evaluate(input, signal, ctx);
        result.grading = grading;
        result.judgeSession = grading.judgeSession;
        result.status = grading.status;
        if (grading.judgeSession)
          await ensureArtifactsInOutputDir(
            this.outputDir,
            rt,
            configuration,
            cfg.id,
            artifactRoot,
            input.artifactDir ?? "",
            grading.judgeSession,
            signal,
          );
      } catch (e) {
        if (e instanceof JudgeEvaluationError) result.grading = e.result;
        const session = sessionResultFromError(e);
        if (session) {
          result.judgeSession = session;
          await ensureArtifactsInOutputDir(
            this.outputDir,
            rt,
            configuration,
            cfg.id,
            artifactRoot,
            input.artifactDir ?? "",
            session,
            signal,
          );
        }
        result.status = "ERROR";
        result.error = new Error(
          "judge evaluation failed: " + asError(e).message,
          { cause: e },
        );
      }
      return result;
    } finally {
      result.configuration = configuration;
      started.span.setAttribute("skilled.case.status", result.status);
      started.span.end();
      await cleanup();
    }
  }
  async newJudgeForCase(
    rt: Runtime,
    configuration: string,
    cfg: JudgeConfig,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<Judge | null> {
    cfg = resolveJudgeScriptPath(this.judgeScriptBaseDir(), cfg);
    const judgeAgent = await this.resolveJudgeAgent(cfg, agent, signal);
    await this.removeDefaultRunSkillsBeforeJudge(
      rt,
      configuration,
      cfg,
      agent,
      signal,
    );
    await this.installJudgeSkills(rt, cfg, judgeAgent, signal);
    try {
      return newJudge(cfg, judgeAgent, rt);
    } catch (e) {
      throw new Error("failed to create judge: " + asError(e).message, {
        cause: e,
      });
    }
  }
  resolvedSkillDir(): string {
    return this.loader?.skillDir ?? this.skillDir;
  }
  judgeScriptBaseDir(): string {
    return this.skillDir.trim() ? this.skillDir : (this.loader?.skillDir ?? "");
  }
  async resolveJudgeAgent(
    cfg: JudgeConfig,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<Agent> {
    if (cfg.type !== "agent_judge") return agent;
    let judgeAgent = agent;
    if (this.evalCfg.engine.name) {
      const resolved = resolveAdapterConfig(
        resolveJudgeConfig(
          cfg,
          this.runnerConfig ?? {
            role: "runner",
            engine: "",
            version: "",
            appliedVersion: "",
            protocol: "",
            provider: "",
            model: "",
            appliedProvider: "",
            appliedModel: "",
            appliedAPIKey: "",
            appliedBaseURL: "",
            apiKey: "",
            baseURL: "",
            kwargs: {},
            warnings: [],
            custom: null,
            providerSource: "",
            modelSource: "",
            apiKeySource: "",
            baseURLSource: "",
          },
          this.resolver,
        ),
        this.resolver,
      );
      logAdapterConfig(resolved);
      try {
        judgeAgent = detectAgentWithResolvedConfig(resolved);
      } catch (e) {
        throw new Error("failed to create judge agent: " + asError(e).message, {
          cause: e,
        });
      }
    }
    try {
      await judgeAgent.checkCredentials(signal);
    } catch (e) {
      throw new Error(
        "judge agent credential check failed: " + asError(e).message,
        { cause: e },
      );
    }
    return judgeAgent;
  }
  async installJudgeSkills(
    rt: Runtime,
    cfg: JudgeConfig,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<void> {
    if (cfg.type !== "agent_judge" || !cfg.skills?.length) return;
    const skillDir = this.resolvedSkillDir();
    for (const [i, ref] of cfg.skills.entries()) {
      if (!ref.path.trim())
        throw new Error(`judge.skills[${i}].path is required`);
      if (!path.isAbsolute(ref.path) && !skillDir.trim())
        throw new Error(
          "judge.skills requires a loader or skill directory to resolve relative local paths",
        );
      try {
        await agent.installSkill(rt, resolveSkillConfig(skillDir, ref), signal);
      } catch (e) {
        throw new Error(
          `failed to install judge skill judge.skills[${i}].path=${JSON.stringify(ref.path)}: ${asError(e).message}`,
          { cause: e },
        );
      }
    }
  }
  async removeDefaultRunSkillsBeforeJudge(
    rt: Runtime,
    configuration: string,
    cfg: JudgeConfig,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<void> {
    if (
      configuration === "without_skill" ||
      cfg.type !== "agent_judge" ||
      !this.evalCfg.skills?.length
    )
      return;
    const skillPath = agentDefaultSkillPath(agent);
    if (!skillPath.trim()) return;
    for (const ref of this.evalCfg.skills ?? []) {
      if (ref.target.trim()) continue;
      const skill = resolveSkillConfig(this.resolvedSkillDir(), ref);
      if (!skill.source.trim()) continue;
      const target = path.join(skillPath, path.basename(skill.source));
      if (isDefaultAgentSkillTarget(skillPath, target))
        await removeRuntimePath(rt, target, signal);
    }
  }
  async prepareRuntimeForCase(
    cfg: CaseConfig,
    configuration: string,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<{ runtime: Runtime; observation: RuntimeObservation }> {
    const provisioned = await this.provisionMCPConfigForCase(cfg),
      runtimeCfg = {
        ...toRuntimeConfig(this.evalCfg.environment),
        delete: this.deleteWorkspace,
        workspaceDir: this.workspaceDir,
        env: { ...this.evalCfg.environment.env, ...provisioned.runEnv },
      } as RuntimeConfig;
    let rt: Runtime;
    try {
      rt = createRuntime(runtimeCfg);
    } catch (e) {
      throw new Error("failed to create runtime: " + asError(e).message, {
        cause: e,
      });
    }
    try {
      await rt.create(signal);
    } catch (e) {
      await rt.close();
      throw new Error(
        "failed to create runtime workspace: " + asError(e).message,
        { cause: e },
      );
    }
    try {
      return {
        runtime: rt,
        observation: await this.setupCaseEnvironment(
          rt,
          cfg,
          configuration,
          agent,
          provisioned.config,
          signal,
        ),
      };
    } catch (e) {
      await rt.close();
      throw new Error(
        "failed to setup case environment: " + asError(e).message,
        { cause: e },
      );
    }
  }
  async setupCaseEnvironment(
    rt: Runtime,
    cfg: CaseConfig,
    configuration: string,
    agent: Agent,
    mcp: MCPConfig,
    signal?: AbortSignal,
  ): Promise<RuntimeObservation> {
    for (const [i, step] of this.evalCfg.environment.setup_steps.entries()) {
      let r;
      try {
        r = await rt.exec(step.run, { signal });
      } catch (e) {
        throw new Error(
          `setup step ${i + 1} (${JSON.stringify(step.run)}) failed: ${asError(e).message}`,
          { cause: e },
        );
      }
      if (r.exitCode !== 0)
        throw new Error(
          `setup step ${i + 1} (${JSON.stringify(step.run)}) exited with code ${r.exitCode}: ${r.stderr}`,
        );
    }
    if (this.evalCfg.environment.type !== "none")
      try {
        await agent.install(rt, signal);
      } catch (e) {
        throw new Error(
          `failed to install agent ${agent.name()}: ${asError(e).message}`,
          { cause: e },
        );
      }
    let observation: RuntimeObservation;
    try {
      observation = await preflight(rt, agent, signal);
    } catch (e) {
      throw new Error(
        `agent ${agent.name()} preflight failed: ${asError(e).message}`,
        { cause: e },
      );
    }
    try {
      await agent.installMCP(rt, mcp, signal);
    } catch (e) {
      throw new Error("failed to install MCP servers: " + asError(e).message, {
        cause: e,
      });
    }
    if (configuration !== "without_skill" && this.loader)
      for (const ref of this.evalCfg.skills ?? [])
        try {
          await agent.installSkill(
            rt,
            resolveSkillConfig(this.loader.skillDir, ref),
            signal,
          );
        } catch (e) {
          throw new Error(
            `failed to install skill ${ref.path}: ${asError(e).message}`,
            { cause: e },
          );
        }
    if (this.loader && this.skillDir)
      try {
        await this.fixtures.uploadAll(
          rt,
          cfg,
          this.skillDir,
          this.loader.skillDir,
          signal,
        );
      } catch (e) {
        throw new Error("failed to upload fixtures: " + asError(e).message, {
          cause: e,
        });
      }
    return observation;
  }
  async provisionMCPConfig(): Promise<{
    config: MCPConfig;
    runEnv: Record<string, string>;
  }> {
    this.mcpPromise ??= new Provisioner(this.resolvedSkillDir())
      .provision(this.evalCfg.mcp)
      .catch((e) => {
        throw new Error(
          "failed to provision MCP servers: " + asError(e).message,
          { cause: e },
        );
      });
    return structuredClone(await this.mcpPromise);
  }
  async provisionMCPConfigForCase(
    cfg: CaseConfig,
  ): Promise<{ config: MCPConfig; runEnv: Record<string, string> }> {
    if (!cfg.mcp.servers.length) return this.provisionMCPConfig();
    try {
      return await new Provisioner(this.resolvedSkillDir()).provision(
        mergeCaseMCP(this.evalCfg.mcp, cfg.mcp),
      );
    } catch (e) {
      throw new Error(
        `case ${cfg.id}: failed to provision MCP servers: ${asError(e).message}`,
        { cause: e },
      );
    }
  }
  prepareOutputDir(
    configuration: string,
    caseID: string,
    subpath: string,
  ): Promise<string> {
    return prepareOutputDir(this.outputDir, configuration, caseID, subpath);
  }
}
export const newEvaluator = (opts: EvalOptions): DefaultEvaluator =>
  new DefaultEvaluator(opts);
export type Evaluator = DefaultEvaluator;
export function startAgentRunSpan(ctx: Context) {
  if (linkedTraceTopologyEnabled())
    return startLinkedRootSpan(ctx, "agent.run");
  const span = tracer().startSpan("agent.run", {}, ctx);
  return { span, context: trace.setSpan(ctx, span) };
}
export function resolveJudgeScriptPath(
  skillDir: string,
  cfg: JudgeConfig,
): JudgeConfig {
  if (cfg.type !== "script" || !cfg.script_path) return cfg;
  return {
    ...cfg,
    script_path: path.resolve(
      path.isAbsolute(cfg.script_path)
        ? cfg.script_path
        : path.join(skillDir, cfg.script_path),
    ),
  };
}
export const agentDefaultSkillPath = (agent: Agent): string =>
  "skillPath" in agent
    ? (agent as Agent & { skillPath(): string }).skillPath()
    : "";
export function isDefaultAgentSkillTarget(
  skillPath: string,
  target: string,
): boolean {
  const relative = path.relative(
    path.normalize(skillPath),
    path.normalize(target),
  );
  return !!relative && relative !== "." && !relative.startsWith("..");
}
export async function removeRuntimePath(
  rt: Runtime,
  target: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!target.trim() || rt.shell().family !== "posix") return;
  const r = await rt.exec("rm -rf -- " + quoter(rt.shell())(target), {
    signal,
  });
  if (r.exitCode !== 0)
    throw new Error(
      `remove ${target} exited with code ${r.exitCode}: ${r.stderr}`,
    );
}
