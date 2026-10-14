// Modified for the skilled TypeScript distribution.
import { Command, CommanderError } from "commander";
import { ROOT_CONTEXT } from "@opentelemetry/api";
import * as userconfig from "../userconfig/index.js";
import { setOutput as setUIOutput } from "../ui/index.js";
import { setOutput as setLogOutput } from "../logging/index.js";
import { init as initObservability } from "../observability/index.js";
import { type CliContext, errorMessage } from "./context.js";
import { registerRunCommand } from "./run.js";
import { registerInitCommand } from "./init.js";
import { registerImportCommand } from "./import.js";
import { registerValidateCommand } from "./validate.js";
import { registerListCasesCommand } from "./listcases.js";
import { registerReportCommand } from "./report.js";
import {
  registerCompletionCommand,
  isCompletionRequest,
  complete,
} from "./completion.js";
import { registerDebugCommand } from "./debug.js";
import { registerCompareCommand } from "./compare.js";
import { registerSetupCommand } from "./setup.js";
import { registerMcpCommand } from "./mcp.js";
export function parseLongFlag(arg: string): {
  name: string;
  hasValue: boolean;
  consumed: number;
} {
  if (!arg.startsWith("--") || arg === "--")
    return { name: "", hasValue: false, consumed: 0 };
  const body = arg.slice(2),
    i = body.indexOf("=");
  return {
    name: i < 0 ? body : body.slice(0, i),
    hasValue: i >= 0,
    consumed: 1,
  };
}
export function extractConfigFlag(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--") return "";
    const p = parseLongFlag(args[i]);
    if (p.name !== "config") continue;
    return p.hasValue ? args[i].slice("--config=".length) : (args[i + 1] ?? "");
  }
  return "";
}
function isInvocation(args: string[], command: string): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") return false;
    const p = parseLongFlag(a);
    if (p.name) {
      if (!p.hasValue && p.name === "config" && i + 1 < args.length) i++;
      continue;
    }
    if (a.startsWith("-")) continue;
    return a === command;
  }
  return false;
}
export function isInitInvocation(args: string[]): boolean {
  return isInvocation(args, "init");
}
export function loadUserConfig(
  args: string[],
  stderr: (text: string) => void = (message) => {
    process.stderr.write(message);
  },
): ReturnType<typeof userconfig.loadEffective> {
  return userconfig.loadEffective({
    explicitPath: isInitInvocation(args) ? "" : extractConfigFlag(args),
    env: (key) => process.env[key] ?? "",
    warnings: { write: stderr },
  });
}
export interface ExecuteOptions {
  signal?: AbortSignal;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}
export function createRoot(version: string, ctx: CliContext): Command {
  const root = new Command("skilled")
    .description(
      "Load eval.yaml, run cases against Agent Engines, and produce reports.",
    )
    .option(
      "--config <path>",
      "Path to skilled user config (overrides discovered defaults)",
      "",
    );
  root.action(() => root.outputHelp());
  root.version(`skilled version ${version}`, "-v, --version");
  root
    .exitOverride()
    .configureOutput({ writeOut: ctx.stdout, writeErr: ctx.stderr });
  registerRunCommand(root, ctx);
  registerValidateCommand(root, ctx);
  registerListCasesCommand(root, ctx);
  registerReportCommand(root, ctx);
  registerDebugCommand(root, ctx);
  registerCompareCommand(root, ctx);
  registerMcpCommand(root, ctx);
  registerSetupCommand(root, ctx);
  registerImportCommand(root, ctx);
  registerInitCommand(root, ctx);
  registerCompletionCommand(root, ctx);
  for (const cmd of [
    root,
    ...root.commands,
    ...root.commands.flatMap((c) => c.commands),
  ])
    cmd.showHelpAfterError();
  return root;
}
const trueValues = new Set(["1", "t", "T", "TRUE", "true", "True"]),
  falseValues = new Set(["0", "f", "F", "FALSE", "false", "False"]);
export function normalizeArgs(root: Command, args: string[]): string[] {
  const commands = [
    root,
    ...root.commands,
    ...root.commands.flatMap((c) => c.commands),
  ];
  const valueOptions = new Set(
    commands.flatMap((cmd) =>
      cmd.options
        .filter((opt) => opt.required)
        .flatMap((opt) =>
          [opt.long, opt.short].filter((v): v is string => !!v),
        ),
    ),
  );
  let selected = root;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") break;
    if (a.startsWith("-")) {
      if (
        !a.includes("=") &&
        valueOptions.has(a) &&
        a !== "--verbose" &&
        a !== "-v"
      )
        i++;
      continue;
    }
    const child = selected.commands.find((c) => c.name() === a);
    if (!child) break;
    selected = child;
  }
  const selectedCommand = selected === root ? "" : selected.name();
  const booleanOptions = new Map(
    selected.options
      .filter((opt) => !opt.required && !opt.optional)
      .map((opt) => [opt.long, { cmd: selected, opt }] as const),
  );
  const result: string[] = [],
    booleanOverrides = new Map<string, { cmd: Command; value: boolean }>();
  let ended = false,
    pendingValue = false;
  for (const raw of args) {
    if (pendingValue) {
      result.push(raw);
      pendingValue = false;
      continue;
    }
    if (ended) {
      result.push(raw);
      continue;
    }
    if (raw === "--") {
      ended = true;
      result.push(raw);
      continue;
    }
    const explicitHelp = /^(--help|-h)=(.*)$/.exec(raw);
    if (explicitHelp) {
      if (trueValues.has(explicitHelp[2])) result.push("--help");
      else if (!falseValues.has(explicitHelp[2]))
        selected.error(`invalid argument '${explicitHelp[2]}' for --help`);
      continue;
    }
    if (selectedCommand === "run" && raw.startsWith("-v=")) {
      result.push("--verbose=" + raw.slice(3));
      continue;
    }
    if (
      selected !== root &&
      (raw === "--version" ||
        raw.startsWith("--version=") ||
        (selectedCommand !== "run" && /^-v+$/.test(raw)))
    )
      selected.error(`unknown option '${raw}'`);
    const token = raw
      .replace(/^--rk(?==|$)/, "--runtime-kwarg")
      .replace(/^--ek(?==|$)/, "--engine-kwarg");
    if (
      selectedCommand === "run" &&
      (token === "--verbose" || /^-v+$/.test(token))
    ) {
      for (let i = 0; i < (token === "--verbose" ? 1 : token.length - 1); i++)
        result.push("--verbose=true");
      continue;
    }
    const equal = token.indexOf("="),
      name = equal < 0 ? token : token.slice(0, equal),
      entry = booleanOptions.get(name);
    if (entry) {
      const value =
        equal < 0
          ? true
          : trueValues.has(token.slice(equal + 1))
            ? true
            : falseValues.has(token.slice(equal + 1))
              ? false
              : undefined;
      if (value === undefined)
        throw new Error(
          `invalid argument ${JSON.stringify(token.slice(equal + 1))} for ${name}: invalid syntax`,
        );
      booleanOverrides.set(entry.opt.attributeName(), {
        cmd: entry.cmd,
        value: entry.opt.negate ? !value : value,
      });
      if (equal < 0 || value) result.push(name);
      continue;
    }
    result.push(token);
    if (equal < 0 && valueOptions.has(name)) pendingValue = true;
  }
  root.hook("preAction", () => {
    for (const [name, { cmd, value }] of booleanOverrides)
      cmd.setOptionValueWithSource(name, value, "cli");
  });
  return result;
}
export async function executeArgs(
  version: string,
  args: string[] = process.argv.slice(2),
  options: ExecuteOptions = {},
): Promise<void> {
  const stdout =
      options.stdout ??
      ((s) => {
        process.stdout.write(s);
      }),
    stderr =
      options.stderr ??
      ((s) => {
        process.stderr.write(s);
      });
  let effective;
  try {
    effective = await loadUserConfig(args, stderr);
  } catch (e) {
    stderr(`error: ${errorMessage(e)}\n`);
    throw e;
  }
  try {
    userconfig.applyEnv(effective.config);
  } catch (e) {
    stderr(`warning: failed to apply user-config env: ${errorMessage(e)}\n`);
  }
  let observability: {
    context: CliContext["context"];
    shutdown: () => Promise<void>;
  };
  try {
    // MCP stdout belongs exclusively to the protocol. Evaluation children
    // initialize their normal telemetry; the long-lived server must not start
    // console exporters that can write non-protocol output here.
    observability = isInvocation(args, "mcp")
      ? { context: ROOT_CONTEXT, shutdown: async () => {} }
      : await initObservability(version);
  } catch (e) {
    stderr(`warning: failed to initialize observability: ${errorMessage(e)}\n`);
    observability = { context: ROOT_CONTEXT, shutdown: async () => {} };
  }
  const ctx: CliContext = {
    signal: options.signal,
    context: observability.context,
    userConfig: effective.config,
    sources: effective.sources,
    stdout,
    stderr,
  };
  const writer = {
    write: (chunk: string | Uint8Array): boolean => {
      stdout(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    },
  };
  const restoreUI = setUIOutput(writer),
    restoreLog = setLogOutput(writer);
  try {
    const root = createRoot(version, ctx);
    if (isCompletionRequest(args)) {
      complete(root, args, ctx);
      return;
    }
    const normalized = normalizeArgs(root, args);
    if (!normalized.length) {
      root.outputHelp();
      return;
    }
    await root.parseAsync(normalized, { from: "user" });
  } catch (e) {
    if (e instanceof CommanderError) {
      if (e.exitCode === 0) return;
    } else stderr(`Error: ${errorMessage(e)}\n`);
    throw e;
  } finally {
    restoreLog();
    restoreUI();
    try {
      await observability.shutdown();
    } catch {}
  }
}
export const execute = (version: string): Promise<void> => executeArgs(version);
