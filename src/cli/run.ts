// Modified for the skilled TypeScript distribution.
import { Command, Option, InvalidArgumentError } from "commander";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { trace, type Span } from "@opentelemetry/api";
import type { CliContext } from "./context.js";
import { parseAnthropicEvals, convertEvalToCase } from "./import.js";
import {
  Loader,
  defaultEvalConfig,
  validateEvalConfig,
  validateCasesWithEvalDefaults,
  resolveCustomEngineConfig,
  type EvalConfig,
  type CaseConfig,
  type ModelConfig,
} from "../config/index.js";
import {
  Resolver,
  defaultConfPath,
  resolveRunnerConfig,
} from "../credentials/index.js";
import {
  resolveAdapterConfig,
  logAdapterConfig,
  detectAgentWithResolvedConfig,
} from "../agent/index.js";
import { newRunner, type EvaluateOptions } from "../runner/index.js";
import type { EvalResult, ProgressObserver } from "../evaluator/index.js";
import { tracer, recordRunStarted } from "../observability/index.js";
import * as logging from "../logging/index.js";
import * as ui from "../ui/index.js";
import { mergeKwargs } from "../userconfig/index.js";
import {
  evaluationEventOptionsFromFlags,
  runEvalWithEventLog,
} from "./run-events.js";

export function parseCLIInteger(value: string): number {
  const fail = () =>
    new InvalidArgumentError(`invalid integer value ${JSON.stringify(value)}`);
  let text = value,
    sign = 1n;
  if (text.startsWith("+") || text.startsWith("-")) {
    if (text[0] === "-") sign = -1n;
    text = text.slice(1);
  }
  let base = 10,
    prefix = "",
    digits = text,
    explicitBase = false;
  if (/^0[xX]/.test(text)) {
    base = 16;
    prefix = "0x";
    digits = text.slice(2);
    explicitBase = true;
  } else if (/^0[bB]/.test(text)) {
    base = 2;
    prefix = "0b";
    digits = text.slice(2);
    explicitBase = true;
  } else if (/^0[oO]/.test(text)) {
    base = 8;
    prefix = "0o";
    digits = text.slice(2);
    explicitBase = true;
  } else if (text.startsWith("0") && text.length > 1) {
    base = 8;
    prefix = "0o";
    digits = text.slice(1);
    explicitBase = true;
  }
  // Go strconv.ParseInt(base=0) permits underscores between digits and directly
  // after a base prefix, including the leading zero of an octal number.
  const alphabet =
    base === 16 ? "0-9a-fA-F" : base === 8 ? "0-7" : base === 2 ? "01" : "0-9";
  if (
    !new RegExp(
      `^${explicitBase ? "_?" : ""}[${alphabet}](?:_?[${alphabet}])*$`,
    ).test(digits)
  )
    throw fail();
  const parsed = sign * BigInt(prefix + digits.replaceAll("_", ""));
  if (
    parsed > BigInt(Number.MAX_SAFE_INTEGER) ||
    parsed < BigInt(Number.MIN_SAFE_INTEGER)
  )
    throw fail();
  return Number(parsed);
}
export function parseVerbosity(value: string, previous = 0): number {
  switch (value.toLowerCase()) {
    case "":
    case "true":
      return previous + 1;
    case "false":
      return 0;
  }
  // The source verbosity implementation uses decimal strconv.Atoi rather than
  // pflag's base-zero integer parser.
  if (!/^[+-]?\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new InvalidArgumentError(
      `invalid integer value ${JSON.stringify(value)}`,
    );
  return Number(value) || 0;
}
export function stringArrayFlag(command: Command, key: string): string[] {
  const values: string[] = command.opts()[key] ?? [];
  // pflag.GetStringArray round-trips its CSV representation; [""] becomes [].
  return values.length === 1 && values[0] === "" ? [] : [...values];
}
const append = (value: string, values: string[] = []) => [...values, value];
export function registerRunCommand(root: Command, ctx: CliContext): void {
  const command = root
    .command("run")
    .description("Run evaluation cases")
    .argument("[path]", "Path to eval.yaml or skill directory")
    .option(
      "--auto",
      "Auto-detect evals/ directory, preferring eval.yaml over evals.json",
      false,
    )
    .option(
      "--include-case-name <pattern>",
      "Include case IDs matching pattern (repeatable)",
      append,
      [],
    )
    .option(
      "--exclude-case-name <pattern>",
      "Exclude case IDs matching pattern (repeatable)",
      append,
      [],
    )
    .option(
      "--format <format>",
      "Report format (json, junit, html), repeatable",
      append,
      [],
    )
    .option("--output-dir <path>", "Report/artifact output directory", "")
    .option(
      "--workspace <path>",
      "Existing host workspace (runtime none, parallelism 1)",
      "",
    )
    .option("--engine <name>", "Override engine name", "")
    .option(
      "--runtime <type>",
      "Override environment.type (none, opensandbox, docker)",
      "",
    )
    .option("--provider <name>", "Override model provider", "")
    .option("--model <name>", "Override model", "")
    .option("--api-key <key>", "API key for model provider", "")
    .option(
      "--parallelism <count>",
      "Override cases.parallelism (1–256)",
      parseCLIInteger,
      0,
    )
    .option("--baseline", "Enable with/without-skill benchmark", false)
    .option(
      "--runtime-kwarg <key=value>",
      "Environment kwarg (repeatable; alias --rk)",
      append,
      [],
    )
    .option(
      "--engine-kwarg <key=value>",
      "Engine kwarg (repeatable; alias --ek)",
      append,
      [],
    )
    .addOption(
      new Option(
        "-v, --verbose <value>",
        "Increase verbosity (-v, -vv, --verbose=2)",
      )
        .argParser(parseVerbosity)
        .default(0),
    )
    .option(
      "--iteration <count>",
      "Repeat N times; 0 auto-appends the next iteration",
      parseCLIInteger,
      0,
    )
    .option("--no-delete", "Keep workspace after evaluation")
    .option("--dry-run", "Validate and list cases without executing", false)
    .option(
      "--event-log <path>",
      "Write v1 evaluation events as JSON Lines",
      "",
    )
    .option(
      "--event-attribute <key=value>",
      "Namespaced string event attribute (repeatable)",
      append,
      [],
    );
  command.action(async (pathname: string | undefined) =>
    runEval(command, pathname === undefined ? [] : [pathname], ctx),
  );
}
export const changed = (command: Command, name: string): boolean =>
  command.getOptionValueSource(name) === "cli";
export async function runEval(
  command: Command,
  args: string[],
  parent: CliContext,
): Promise<void> {
  const span = tracer().startSpan("cli.run", undefined, parent.context);
  const ctx = { ...parent, context: trace.setSpan(parent.context, span) };
  const spanContext = span.spanContext();
  if (trace.isSpanContextValid(spanContext))
    logging.infoContextf(ctx.context, "Trace ID: %s", spanContext.traceId);
  logging.setVerbosity(command.opts().verbose ?? 0);
  try {
    const { cases, evalCfg, loader } = await loadAndPrepareConfig(
      command,
      args,
      ctx,
      span,
    );
    const eventOptions = evaluationEventOptionsFromFlags(command);
    if (eventOptions.enabled) {
      if (command.opts().dryRun)
        throw new Error("--event-log cannot be used with --dry-run");
      await runEvalWithEventLog(
        command,
        cases,
        evalCfg,
        loader,
        eventOptions,
        ctx,
      );
      return;
    }
    if (command.opts().dryRun) {
      ctx.stdout(
        `Would run ${cases.length} case(s) with agent ${evalCfg.engine.name}\n`,
      );
      for (const c of cases) ctx.stdout(`  - ${c.id}\n`);
      return;
    }
    const { ag, resolver, runnerConfig } = await loadCredentialsAndAgent(
      command,
      evalCfg,
      ctx,
    );
    ui.blank();
    ui.stepf("🚀", "Running evaluation (%d cases)", cases.length);
    const opts = evaluateOptionsFromFlags(command);
    if (!opts.formats?.length) opts.formats = evalCfg.report.formats;
    opts.observer = uiProgressObserver;
    let results: EvalResult[];
    try {
      results = await newRunner(
        evalCfg,
        loader,
        resolver,
        runnerConfig,
      ).evaluate(cases, ag, opts, ctx.signal, ctx.context);
    } catch (e) {
      throw new Error(`failed to evaluate cases: ${(e as Error).message}`, {
        cause: e,
      });
    }
    printRunSummary(results);
    const error = exitStatusError(ctx.stderr, results);
    if (error) throw error;
  } finally {
    logging.setVerbosity(0);
    span.end();
  }
}
export async function loadAndPrepareConfig(
  command: Command,
  args: string[],
  ctx: CliContext,
  span?: Span,
) {
  ui.step("📋", "Loading configuration...");
  const loaded = await loadRunInputs(command, args, ctx);
  let { cases, evalCfg } = loaded;
  if (!cases.length) throw new Error("no cases found");
  const o = command.opts();
  const include = stringArrayFlag(command, "includeCaseName"),
    exclude = stringArrayFlag(command, "excludeCaseName");
  if (include.length || exclude.length)
    cases = filterCases(cases, include, exclude);
  if (!cases.length) throw new Error("no cases matched the filter");
  try {
    validateCasesWithEvalDefaults(evalCfg, cases);
  } catch (e) {
    throw new Error(`validation failed: ${(e as Error).message}`, { cause: e });
  }
  evalCfg = resolveEvalConfig(evalCfg, o.engine);
  await applyRunConfigOverrides(evalCfg, command, ctx);
  try {
    resolveCustomEngineConfig(evalCfg, {
      skipModelProvider: Boolean(o.provider || o.model),
      skipModelName: Boolean(o.model),
    });
  } catch (e) {
    throw new Error(`engine config: ${(e as Error).message}`, { cause: e });
  }
  const model = requestedModelRef(evalCfg.engine.model, o.provider, o.model);
  span?.setAttributes({
    "skilled.cases.count": cases.length,
    "skilled.engine": evalCfg.engine.name,
    "skilled.model": model,
  });
  recordRunStarted(ctx.context, evalCfg.engine.name, model, cases.length);
  logging.debugContextf(
    ctx.context,
    "Config: loaded %d case(s); engine=%s model=%s parallelism=%d",
    cases.length,
    evalCfg.engine.name,
    model,
    evalCfg.cases.parallelism,
  );
  logging.debugContextf(
    ctx.context,
    "Config: include-case-name=%j exclude-case-name=%j",
    include,
    exclude,
  );
  ui.statusf(
    "✅",
    "Loaded %d case(s) | engine: %s | model: %s",
    cases.length,
    evalCfg.engine.name,
    model,
  );
  return { cases, evalCfg, loader: loaded.loader };
}
export async function loadCredentialsAndAgent(
  command: Command,
  cfg: EvalConfig,
  ctx: CliContext,
) {
  ui.blank();
  ui.step("🔑", "Loading credentials...");
  const o = command.opts();
  const resolver = new Resolver(defaultConfPath());
  try {
    await resolver.load();
  } catch (e) {
    throw new Error(`failed to load credentials: ${(e as Error).message}`, {
      cause: e,
    });
  }
  const runnerConfig = resolveAdapterConfig(
    resolveRunnerConfig(cfg.engine, resolver, {
      provider: o.provider,
      model: o.model,
      apiKey: o.apiKey,
    }),
    resolver,
  );
  logAdapterConfig(runnerConfig);
  let ag;
  try {
    ag = detectAgentWithResolvedConfig(runnerConfig);
  } catch (e) {
    throw new Error(`failed to create agent: ${(e as Error).message}`, {
      cause: e,
    });
  }
  ui.status("✅", "Credentials ready");
  return { ag, resolver, runnerConfig };
}
export const uiProgressObserver: ProgressObserver = {
  onCaseStart: ui.caseStart,
  onCaseComplete: ui.caseComplete,
};
export function countResultStatus(results: EvalResult[]) {
  return {
    passed: results.filter((r) => r.status === "PASS").length,
    failed: results.filter((r) => r.status === "FAIL").length,
    errored: results.filter((r) => r.status === "ERROR").length,
  };
}
export function printRunSummary(results: EvalResult[]): void {
  ui.separator();
  const { passed, failed, errored } = countResultStatus(results);
  ui.summary(passed, failed, errored);
}
export function exitStatusError(
  stderr: ((text: string) => void) | undefined,
  results: EvalResult[],
): Error | undefined {
  const considered = results.filter((r) => r.configuration !== "without_skill");
  if (considered.some((r) => r.status === "ERROR")) {
    for (const r of considered)
      if (r.status === "ERROR")
        stderr?.(
          `[ERROR] case ${r.caseID || "<unknown>"}: ${r.error?.message ?? "<nil>"}\n`,
        );
    return new Error("one or more cases errored");
  }
  if (considered.some((r) => r.status === "FAIL"))
    return new Error("one or more cases failed");
  return undefined;
}
export function evaluateOptionsFromFlags(command: Command): EvaluateOptions {
  const o = command.opts();
  if (o.iteration < 0)
    throw new Error(`invalid --iteration ${o.iteration}: must be >= 0`);
  const formats = stringArrayFlag(command, "format");
  for (const f of formats)
    if (!["json", "junit", "html"].includes(f))
      throw new Error(
        `unsupported --format ${JSON.stringify(f)} (supported: json, junit, html)`,
      );
  return {
    deleteWorkspace: o.delete !== false,
    outputDir: o.outputDir,
    workspaceDir: o.workspace ? path.resolve(o.workspace) : "",
    iteration: o.iteration,
    formats,
  };
}
export function resolveEvalConfig(
  cfg: EvalConfig | undefined,
  engine: string,
): EvalConfig {
  cfg ??= defaultEvalConfig();
  cfg.engine.name = engine || cfg.engine.name || "claude_code";
  return cfg;
}
export function applyMapKwargFlag(
  command: Command,
  name: string,
  attr: string,
  dest: Record<string, string>,
): void {
  if (!changed(command, attr)) return;
  for (const value of stringArrayFlag(command, attr)) {
    const split = value.indexOf("="),
      key = value.slice(0, split < 0 ? 0 : split).trim();
    if (split < 0 || !key)
      throw new Error(
        `invalid --${name} ${JSON.stringify(value)}: expected key=value`,
      );
    Object.defineProperty(dest, key, {
      value: value.slice(split + 1),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
}
export async function applyRunConfigOverrides(
  cfg: EvalConfig,
  command: Command,
  ctx: CliContext,
): Promise<void> {
  const o = command.opts();
  applyMapKwargFlag(
    command,
    "runtime-kwarg",
    "runtimeKwarg",
    cfg.environment.kwargs,
  );
  applyMapKwargFlag(command, "engine-kwarg", "engineKwarg", cfg.engine.kwargs);
  if (changed(command, "runtime")) {
    const value = o.runtime.trim();
    if (!["none", "opensandbox", "docker"].includes(value))
      throw new Error(
        `invalid --runtime ${JSON.stringify(value)} (supported: none, opensandbox, docker)`,
      );
    if (value === "none" && cfg.environment.network_policy)
      throw new Error(
        `--runtime none is incompatible with network_policy ${JSON.stringify(cfg.environment.network_policy)} (none cannot enforce network isolation)`,
      );
    if (value === "docker") {
      if (!cfg.environment.image.trim())
        throw new Error(
          "--runtime docker requires environment.image to be set in the eval config",
        );
      const mount = cfg.environment.workspace_mount.trim();
      if (mount && !path.posix.isAbsolute(mount))
        throw new Error(
          `--runtime docker requires environment.workspace_mount to be absolute, got ${JSON.stringify(mount)}`,
        );
      if (
        cfg.environment.network_policy.trim().toLowerCase() === "allow_declared"
      )
        throw new Error(
          "--runtime docker does not support network_policy=allow_declared (use deny_all or run on opensandbox)",
        );
    }
    cfg.environment.type = value;
  }
  if (changed(command, "baseline") && o.baseline) cfg.benchmark.enabled = true;
  cfg.environment.kwargs = mergeKwargs(
    ctx.userConfig,
    cfg.environment.type,
    cfg.environment.kwargs,
  );
  if (changed(command, "parallelism")) {
    if (o.parallelism < 1)
      throw new Error(`invalid --parallelism ${o.parallelism}: must be >= 1`);
    if (o.parallelism > 256)
      throw new Error(`invalid --parallelism ${o.parallelism}: must be <= 256`);
    cfg.cases.parallelism = o.parallelism;
  }
  if (changed(command, "workspace")) {
    if (!o.workspace.trim()) throw new Error("--workspace must not be empty");
    if (cfg.environment.type !== "none")
      throw new Error(
        `--workspace requires runtime none, got ${JSON.stringify(cfg.environment.type)}`,
      );
    if (cfg.cases.parallelism !== 1)
      throw new Error(
        `--workspace requires cases.parallelism 1, got ${cfg.cases.parallelism}`,
      );
    if (cfg.benchmark.enabled)
      throw new Error(
        "--workspace cannot be used with benchmark.enabled because benchmark variants require isolated workspaces",
      );
    let info;
    try {
      info = await stat(o.workspace);
    } catch (e) {
      throw new Error(
        `access --workspace ${JSON.stringify(o.workspace)}: ${(e as Error).message}`,
        { cause: e },
      );
    }
    if (!info.isDirectory())
      throw new Error(
        `--workspace ${JSON.stringify(o.workspace)} is not a directory`,
      );
  }
}
export function formatModelRef(provider: string, name: string): string {
  return provider && name
    ? `${provider}/${name}`
    : name || provider || "<unset>";
}
export function requestedModelRef(
  model: ModelConfig,
  provider = "",
  name = "",
): string {
  if (name) return provider ? formatModelRef(provider, name) : name;
  return formatModelRef(provider || model.provider, model.name);
}
export async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}
export async function isRegularFile(file: string): Promise<boolean> {
  try {
    return !(await stat(file)).isDirectory();
  } catch {
    return false;
  }
}
export async function isDirectory(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isDirectory();
  } catch {
    return false;
  }
}
export async function defaultAutoSkills(loader: Loader | undefined) {
  return loader && (await isRegularFile(path.join(loader.skillDir, "SKILL.md")))
    ? [
        {
          source: "local_path",
          path: ".",
          target: "",
          include: [],
          exclude: [],
        },
      ]
    : [];
}
export async function discoverFromWorkingTree(
  match: (dir: string) => Promise<string | undefined>,
  miss: string,
): Promise<string> {
  for (let dir = path.resolve(process.cwd()); ; dir = path.dirname(dir)) {
    const found = await match(dir);
    if (found) return found;
    if (path.dirname(dir) === dir) break;
  }
  throw new Error(miss);
}
export async function resolveEvalPath(
  ctx: CliContext,
  args: string[],
): Promise<string> {
  if (args.length) return args[0];
  try {
    const p = await discoverFromWorkingTree(
      async (dir) =>
        (await isRegularFile(path.join(dir, "SKILL.md"))) &&
        (await isRegularFile(path.join(dir, "evals/eval.yaml")))
          ? path.join(dir, "evals/eval.yaml")
          : undefined,
      "no directory from here to filesystem root contains both SKILL.md and evals/eval.yaml",
    );
    logging.infoContextf(ctx.context, "Config: discovered eval.yaml: %s", p);
    return p;
  } catch (e) {
    throw new Error(
      `eval path required, or run from a skill directory containing SKILL.md and evals/eval.yaml: ${(e as Error).message}`,
      { cause: e },
    );
  }
}
export async function normalizeAutoEvalRoot(p: string): Promise<string> {
  if (await isRegularFile(p)) {
    const dir = path.dirname(p);
    if (path.basename(dir) !== "evals")
      throw new Error(
        `auto eval file path must be inside an evals directory: ${p}`,
      );
    return path.dirname(dir);
  }
  if (await isDirectory(p)) return p;
  throw new Error(`auto eval path not found or unsupported: ${p}`);
}
export async function resolveAutoEvalRoot(
  ctx: CliContext,
  args: string[],
): Promise<string> {
  if (args.length) return normalizeAutoEvalRoot(args[0]);
  try {
    const p = await discoverFromWorkingTree(
      async (dir) =>
        (await isRegularFile(path.join(dir, "SKILL.md"))) &&
        ((await isRegularFile(path.join(dir, "evals/evals.json"))) ||
          (await isRegularFile(path.join(dir, "evals/eval.yaml"))))
          ? dir
          : undefined,
      "no directory from here to filesystem root contains SKILL.md and evals/evals.json or evals/eval.yaml",
    );
    logging.infoContextf(
      ctx.context,
      "Config: discovered auto eval root: %s",
      p,
    );
    return p;
  } catch (e) {
    throw new Error(
      `eval path required, or run from a skill directory containing SKILL.md and evals/evals.json or evals/eval.yaml: ${(e as Error).message}`,
      { cause: e },
    );
  }
}
export async function loadFromEvalYAML(evalPath: string) {
  const loader = await Loader.create(evalPath);
  let result;
  try {
    result = await loader.loadAll();
  } catch (e) {
    throw new Error(`failed to load config: ${(e as Error).message}`, {
      cause: e,
    });
  }
  if (result.eval.skills == null)
    result.eval.skills = await defaultAutoSkills(loader);
  try {
    validateEvalConfig(result.eval);
  } catch (e) {
    throw new Error(`validation failed: ${(e as Error).message}`, { cause: e });
  }
  return { evalPath, cases: result.cases, evalCfg: result.eval, loader };
}
export async function loadManualModeEvaluation(
  ctx: CliContext,
  target: string,
) {
  const evalPath = (await isRegularFile(target))
    ? target
    : (await isRegularFile(path.join(target, "evals/eval.yaml")))
      ? path.join(target, "evals/eval.yaml")
      : undefined;
  if (!evalPath) throw new Error(`eval.yaml not found at ${target}`);
  logging.infoContextf(
    ctx.context,
    "Config: loading eval.yaml from %s",
    evalPath,
  );
  return loadFromEvalYAML(evalPath);
}
export async function loadAnthropicEvals(file: string): Promise<CaseConfig[]> {
  let data: string;
  try {
    data = await readFile(file, "utf8");
  } catch (e) {
    throw new Error(`failed to read evals.json: ${(e as Error).message}`, {
      cause: e,
    });
  }
  let parsed;
  try {
    parsed = parseAnthropicEvals(data);
  } catch (e) {
    throw new Error(`failed to parse evals.json: ${(e as Error).message}`, {
      cause: e,
    });
  }
  return parsed.evals.map((e) => convertEvalToCase(e, parsed.skill_name));
}
export async function loadAutoModeEvaluation(ctx: CliContext, target: string) {
  const yaml = path.join(target, "evals/eval.yaml"),
    json = path.join(target, "evals/evals.json");
  if (await fileExists(yaml)) {
    logging.infoContextf(
      ctx.context,
      "Config: Auto-detected eval.yaml at %s",
      yaml,
    );
    return loadFromEvalYAML(yaml);
  }
  if (await fileExists(json)) {
    logging.infoContextf(
      ctx.context,
      "Config: Auto-detected Anthropic evals.json at %s",
      json,
    );
    const cases = await loadAnthropicEvals(json),
      loader = await Loader.create(json),
      evalCfg = defaultEvalConfig();
    evalCfg.skills = await defaultAutoSkills(loader);
    return { cases, evalCfg, loader };
  }
  throw new Error(
    `no evals/ directory found at ${target} (looked for eval.yaml and evals.json)`,
  );
}
export async function loadRunInputs(
  command: Command,
  args: string[],
  ctx: CliContext,
) {
  return command.opts().auto
    ? loadAutoModeEvaluation(ctx, await resolveAutoEvalRoot(ctx, args))
    : loadManualModeEvaluation(ctx, await resolveEvalPath(ctx, args));
}
// Go path.Match has no doublestar, brace expansion, or leading-dot exception.
export function goPathMatch(pattern: string, name: string): boolean {
  type Token =
    | { kind: "star" }
    | { kind: "any" }
    | { kind: "literal"; value: string }
    | { kind: "class"; negate: boolean; ranges: [number, number][] };
  const p = Array.from(pattern),
    n = Array.from(name),
    tokens: Token[] = [];
  let i = 0;
  const char = (): number => {
    if (i >= p.length || p[i] === "-" || p[i] === "]") throw Error();
    if (p[i] === "\\") i++;
    if (i >= p.length) throw Error();
    const c = p[i++].codePointAt(0)!;
    if (i >= p.length) throw Error();
    return c;
  };
  try {
    while (i < p.length) {
      const c = p[i++];
      if (c === "*") tokens.push({ kind: "star" });
      else if (c === "?") tokens.push({ kind: "any" });
      else if (c === "[") {
        const negate = p[i] === "^";
        if (negate) i++;
        const ranges: [number, number][] = [];
        while (!(p[i] === "]" && ranges.length)) {
          const lo = char();
          let hi = lo;
          if (p[i] === "-") {
            i++;
            hi = char();
          }
          ranges.push([lo, hi]);
        }
        i++;
        tokens.push({ kind: "class", negate, ranges });
      } else if (c === "\\") {
        if (i >= p.length) return false;
        tokens.push({ kind: "literal", value: p[i++] });
      } else tokens.push({ kind: "literal", value: c });
    }
  } catch {
    return false;
  }
  // Track reachable token positions instead of recursing once per character.
  // This keeps long valid Go patterns independent of the JavaScript call stack.
  const closure = (states: Set<number>): Set<number> => {
    const pending = [...states];
    for (let at = 0; at < pending.length; at++) {
      const t = pending[at];
      if (tokens[t]?.kind === "star" && !states.has(t + 1)) {
        states.add(t + 1);
        pending.push(t + 1);
      }
    }
    return states;
  };
  let states = closure(new Set([0]));
  for (const rune of n) {
    const next = new Set<number>();
    for (const t of states) {
      const token = tokens[t];
      if (!token) continue;
      if (token.kind === "star") {
        if (rune !== "/") next.add(t);
        continue;
      }
      const yes =
        token.kind === "any"
          ? rune !== "/"
          : token.kind === "literal"
            ? token.value === rune
            : token.ranges.some(
                ([lo, hi]) =>
                  lo <= rune.codePointAt(0)! && rune.codePointAt(0)! <= hi,
              ) !== token.negate;
      if (yes) next.add(t + 1);
    }
    if (!next.size) return false;
    states = closure(next);
  }
  return states.has(tokens.length);
}
export function filterCases(
  cases: CaseConfig[],
  include: string[],
  exclude: string[],
): CaseConfig[] {
  return cases.filter(
    (c) =>
      !exclude.some((p) => goPathMatch(p, c.id)) &&
      (!include.length || include.some((p) => goPathMatch(p, c.id))),
  );
}
