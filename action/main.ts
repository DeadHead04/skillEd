#!/usr/bin/env node
// Modified for the skilled TypeScript distribution.
/** Public GitHub Action adapter. Evaluation behavior remains in the CLI. */
import { spawn } from "node:child_process";
import {
  access,
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  stat,
} from "node:fs/promises";
import { constants } from "node:fs";
import { constants as osConstants, homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { Command, CommanderError } from "commander";
import { VERSION } from "../src/brand.js";
export const providers: Record<string, Record<string, string>> = {
  dashscope: {
    openai: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    anthropic: "https://dashscope.aliyuncs.com/apps/anthropic",
  },
};
export const engineProtocol: Record<string, string | null> = {
  claude_code: "anthropic",
  codex: "openai",
  opencode: "openai",
  qodercli: null,
  qwen_code: "openai",
};
export const providerEnvPrefix = (provider: string): string =>
  provider.toUpperCase().replaceAll("-", "_");
export function resolveBaseURL(
  engine: string,
  provider: string,
  baseURL: string,
): string {
  if (!engine) return baseURL || "";
  if (!Object.hasOwn(engineProtocol, engine))
    throw new Error(
      `unknown engine: '${engine}' (expected one of ${Object.keys(engineProtocol).sort().join(", ")})`,
    );
  if (baseURL) return baseURL;
  const protocol = engineProtocol[engine];
  return protocol ? (providers[provider]?.[protocol] ?? "") : "";
}
export function engineEnv(
  engine: string,
  key: string,
  baseURL: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  if (engine === "claude_code") {
    if (key) {
      env.ANTHROPIC_API_KEY = key;
      env.ANTHROPIC_AUTH_TOKEN = key;
    }
    if (baseURL) env.ANTHROPIC_BASE_URL = baseURL;
  } else if (["codex", "opencode", "qwen_code"].includes(engine)) {
    if (key) env.OPENAI_API_KEY = key;
    if (baseURL) env.OPENAI_BASE_URL = baseURL;
  } else if (engine === "qodercli" && key)
    env.QODER_PERSONAL_ACCESS_TOKEN = key;
  return env;
}
export function engineModelEnv(
  engine: string,
  model: string,
): Record<string, string> {
  if (!model) return {};
  return engine === "claude_code"
    ? { ANTHROPIC_MODEL: model }
    : ["codex", "opencode", "qwen_code"].includes(engine)
      ? { OPENAI_MODEL: model }
      : {};
}
export function unifiedBaseURLEnv(
  provider: string,
  baseURL: string,
): Record<string, string> {
  if (baseURL) return { OPENAI_BASE_URL: baseURL, ANTHROPIC_BASE_URL: baseURL };
  const out: Record<string, string> = {},
    mapping = providers[provider] ?? {};
  if (mapping.openai) out.OPENAI_BASE_URL = mapping.openai;
  if (mapping.anthropic) out.ANTHROPIC_BASE_URL = mapping.anthropic;
  return out;
}
export function providerEnv(
  provider: string,
  key: string,
  baseURL: string,
): Record<string, string> {
  if (!provider) return {};
  const prefix = providerEnvPrefix(provider);
  return {
    ...(key ? { [prefix + "_API_KEY"]: key } : {}),
    ...(baseURL ? { [prefix + "_BASE_URL"]: baseURL } : {}),
  };
}
export type VersionTuple = [number, number, number];
export function parseSkilledVersion(stdout: string): VersionTuple | null {
  const line = stdout.trim().split(/\r?\n/)[0];
  if (!line) return null;
  const parts = line
    .trim()
    .split(/\s+/)
    .at(-1)!
    .replace(/^v+/, "")
    .split(".")
    .slice(0, 3);
  if (parts.some((p) => !/^[-+]?\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  while (nums.length < 3) nums.push(0);
  return nums as VersionTuple;
}
export function versionSupportsBypassSandbox(
  version: VersionTuple | null,
): boolean {
  return (
    !!version &&
    (version[0] > 0 ||
      (version[0] === 0 &&
        (version[1] > 2 || (version[1] === 2 && version[2] >= 3))))
  );
}
export function shellSplit(value: string): string[] {
  const words: string[] = [];
  let word = "",
    quote = "",
    started = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote) {
      if (c === quote) {
        quote = "";
        continue;
      }
      if (c === "\\" && quote === '"') {
        const next = value[++i];
        if (next === undefined) throw new Error("No escaped character");
        word += next === '"' || next === "\\" ? next : "\\" + next;
      } else word += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      started = true;
      continue;
    }
    if (c === "\\") {
      const next = value[++i];
      if (next === undefined) throw new Error("No escaped character");
      word += next;
      started = true;
      continue;
    }
    if (" \t\r\n".includes(c)) {
      if (started) {
        words.push(word);
        word = "";
        started = false;
      }
      continue;
    }
    word += c;
    started = true;
  }
  if (quote) throw new Error("No closing quotation");
  if (started) words.push(word);
  return words;
}
export const shellQuote = (value: string): string =>
  /^[\w@%+=:,./-]+$/.test(value)
    ? value
    : "'" + value.replaceAll("'", "'\"'\"'") + "'";
export function validateParallelism(value: string | null | undefined): string {
  if (value == null || value === "") return "";
  // Python int accepts Unicode decimal digits after its isdigit check.
  if (!/^\p{Decimal_Number}+$/u.test(value))
    throw new Error("parallelism must be a positive integer between 1 and 256");
  const normalized = Array.from(value, (digit) => {
    const code = digit.codePointAt(0)!;
    let first = code;
    while (
      first > 0 &&
      /\p{Decimal_Number}/u.test(String.fromCodePoint(first - 1))
    )
      first--;
    return String((code - first) % 10);
  }).join("");
  const count = Number(normalized);
  if (count < 1 || count > 256)
    throw new Error("parallelism must be a positive integer between 1 and 256");
  return String(count);
}
export const composeModelRef = (
  provider: string,
  model: string,
  engine: string,
): string =>
  model && engine === "codex" && provider && !model.includes("/")
    ? provider + "/" + model
    : model;
export function maskArgvForLog(argv: string[]): string[] {
  const masked = [...argv];
  for (let i = 0; i < masked.length; i++)
    if (masked[i] === "--api-key" && i + 1 < masked.length)
      masked[i + 1] = "***";
  return masked;
}
export function buildSkilledArgv(
  command: string,
  engine: string,
  model: string,
  provider: string,
  parallelism: string,
  outputDir: string,
  target: string,
  key = "",
  bypass = false,
  explicitProvider = false,
): string[] {
  const argv = shellSplit(command);
  if (argv[0] !== "skilled")
    throw new Error("skilled-command must start with 'skilled'");
  if (engine) argv.push("--engine", engine);
  else if (key) argv.push("--api-key", key);
  const explicit = explicitProvider && provider && engine;
  if (explicit) argv.push("--provider", provider);
  const ref = explicit ? model : composeModelRef(provider, model, engine);
  if (ref) argv.push("--model", ref);
  const count = validateParallelism(parallelism);
  if (count) argv.push("--parallelism", count);
  if (bypass) argv.push("--engine-kwarg", "bypass_sandbox=true");
  argv.push(
    "--output-dir",
    outputDir,
    "--format",
    "json",
    "--format",
    "junit",
    "--format",
    "html",
    target,
  );
  return argv;
}
interface ProcessOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  capture?: boolean;
}
export async function runProcess(
  argv: string[],
  options: ProcessOptions = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "",
      stderr = "";
    child.stdout?.on("data", (data) => (stdout += data));
    child.stderr?.on("data", (data) => (stderr += data));
    child.on("error", reject);
    child.on("close", (code, signal) =>
      resolve({
        code: code ?? -(signal ? osConstants.signals[signal] : 1),
        stdout,
        stderr,
      }),
    );
  });
}
export async function getSkilledVersion(
  env: NodeJS.ProcessEnv = {},
): Promise<VersionTuple | null> {
  try {
    const result = await runProcess(["skilled", "--version"], {
      env,
      capture: true,
    });
    return result.code === 0 ? parseSkilledVersion(result.stdout) : null;
  } catch {
    return null;
  }
}
export async function commandSupportsFlag(
  command: string,
  flag: string,
  env: NodeJS.ProcessEnv = {},
): Promise<boolean> {
  let argv: string[];
  try {
    argv = shellSplit(command);
  } catch {
    return false;
  }
  if (argv[0] !== "skilled") return false;
  try {
    const result = await runProcess([...argv, "--help"], {
      env,
      capture: true,
    });
    return (
      result.code === 0 &&
      result.stdout
        .split("\n")
        .some(
          (line) => line.trim() === flag || line.trim().startsWith(flag + " "),
        )
    );
  } catch {
    return false;
  }
}
export const commandSupportsExplicitProvider = (
  command: string,
  env: NodeJS.ProcessEnv = {},
): Promise<boolean> => commandSupportsFlag(command, "--provider", env);
export interface Inputs {
  engine: string;
  model: string;
  provider: string;
  apiKey: string;
  baseUrl: string;
  openSandboxApiKey: string;
  skillTarget: string;
  skilledVersion: string;
  skilledCommand: string;
  parallelism: string;
  agentInstallCommand: string;
}
export function parseInputs(args: string[]): Inputs {
  const cmd = new Command()
    .name("skilled-action")
    .description("skilled GitHub Action")
    .exitOverride();
  for (const key of [
    "engine",
    "model",
    "provider",
    "api-key",
    "base-url",
    "open-sandbox-api-key",
    "parallelism",
    "agent-install-command",
  ])
    cmd.option(`--${key} <value>`, key, "");
  cmd
    .option("--skill-target <path>", "Skill target", ".")
    .option(
      "--skilled-version <version>",
      "Fallback CLI version",
      VERSION,
    )
    .option("--skilled-command <command>", "CLI command", "skilled run");
  cmd.parse(args, { from: "user" });
  return cmd.opts<Inputs>();
}
export async function which(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    const file = path.join(dir, command);
    try {
      await access(file, constants.X_OK);
      if ((await stat(file)).isFile()) return file;
    } catch {}
  }
  return undefined;
}
export async function installSkilled(
  binDir: string,
  version: string,
): Promise<void> {
  await mkdir(binDir, { recursive: true });
  const env: NodeJS.ProcessEnv = { INSTALL_DIR: binDir };
  if (version && version !== "latest") env.SKILLED_VERSION = version;
  const url = process.env.SKILLED_INSTALL_URL;
  let installer: Uint8Array;
  if (url) {
    const expected = process.env.SKILLED_INSTALL_SHA256;
    if (!expected || !/^[a-f0-9]{64}$/i.test(expected))
      throw new Error(
        "SKILLED_INSTALL_SHA256 is required with SKILLED_INSTALL_URL",
      );
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok)
      throw new Error(
        `failed to download skilled installer: HTTP ${response.status}`,
      );
    installer = new Uint8Array(await response.arrayBuffer());
    const actual = createHash("sha256").update(installer).digest("hex");
    if (actual !== expected.toLowerCase())
      throw new Error(
        `skilled installer checksum mismatch (expected ${expected}, got ${actual})`,
      );
  } else
    installer = await readFile(new URL("../../install.sh", import.meta.url));
  const temp = await mkdtemp(path.join(tmpdir(), "skilled-action-install-"));
  try {
    const file = path.join(temp, "install.sh");
    await writeFile(file, installer, { mode: 0o600 });
    const result = await runProcess(["bash", file], { env });
    if (result.code) throw new ProcessExit(result.code);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
class ProcessExit extends Error {
  constructor(readonly code: number) {
    super(`process exited with code ${code}`);
  }
}
async function runScript(
  script: string,
  env: NodeJS.ProcessEnv = {},
): Promise<void> {
  const result = await runProcess(["bash", "-c", script], { env });
  if (result.code) throw new ProcessExit(result.code);
}
export async function setOutput(
  name: string,
  value: string | number,
): Promise<void> {
  const file = process.env.GITHUB_OUTPUT;
  if (file)
    try {
      await appendFile(file, `${name}=${value}\n`);
    } catch {}
}
export async function main(
  args: string[] = process.argv.slice(2),
): Promise<number> {
  let inputs: Inputs;
  try {
    inputs = parseInputs(args);
  } catch (e) {
    return e instanceof CommanderError && e.exitCode === 0 ? 0 : 2;
  }
  try {
    const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd(),
      outputDir = path.join(workspace, "skilled-workspace"),
      toolBin = path.join(homedir(), ".skilled-tools", "bin");
    let baseURL: string;
    try {
      baseURL = resolveBaseURL(inputs.engine, inputs.provider, inputs.baseUrl);
    } catch (e) {
      console.error(`error: ${(e as Error).message}`);
      return 2;
    }
    console.log(
      `engine=${inputs.engine || "<eval.yaml>"} provider=${inputs.provider || "<none>"} base-url=${baseURL || "<agent default>"}`,
    );
    const available = await which("skilled");
    let pathEnv: NodeJS.ProcessEnv = {};
    if (available) {
      console.log(
        `skilled already available at ${available}, skipping install.`,
      );
      if (!["latest", ""].includes(inputs.skilledVersion))
        console.log(
          `Note: --skilled-version=${inputs.skilledVersion} ignored (using pre-installed version).`,
        );
    } else {
      await installSkilled(toolBin, inputs.skilledVersion);
      pathEnv = { PATH: toolBin + path.delimiter + (process.env.PATH ?? "") };
    }
    await runScript("skilled --version", pathEnv);
    await getSkilledVersion(pathEnv);
    // New product versions restart at 0.1; probe the actual CLI capability.
    const bypass = await commandSupportsFlag(
        inputs.skilledCommand,
        "--engine-kwarg",
        pathEnv,
      ),
      explicit = await commandSupportsExplicitProvider(
        inputs.skilledCommand,
        pathEnv,
      );
    if (bypass)
      console.log(
        "skilled supports --engine-kwarg; will pass bypass_sandbox=true for restricted images.",
      );
    if (inputs.agentInstallCommand) {
      console.log("Running custom install command from action input.");
      await runScript(inputs.agentInstallCommand, pathEnv);
    }
    const check: Record<string, string> = {
      codex: "command -v codex >/dev/null && codex --version",
      opencode: "command -v opencode >/dev/null && opencode --version",
      claude_code: "command -v claude >/dev/null",
      qodercli: "command -v qodercli >/dev/null",
    };
    if (check[inputs.engine]) await runScript(check[inputs.engine], pathEnv);
    await mkdir(outputDir, { recursive: true });
    let argv: string[];
    try {
      argv = buildSkilledArgv(
        inputs.skilledCommand,
        inputs.engine,
        inputs.model,
        inputs.provider,
        inputs.parallelism,
        outputDir,
        inputs.skillTarget,
        inputs.apiKey,
        bypass,
        explicit,
      );
    } catch (e) {
      console.error(`error: ${(e as Error).message}`);
      return 2;
    }
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...pathEnv,
      IS_SANDBOX: "1",
      ...(inputs.openSandboxApiKey
        ? { OPENSANDBOX_API_KEY: inputs.openSandboxApiKey }
        : {}),
      ...(inputs.engine
        ? {
            ...engineEnv(inputs.engine, inputs.apiKey, baseURL),
            ...engineModelEnv(inputs.engine, inputs.model),
          }
        : unifiedBaseURLEnv(inputs.provider, inputs.baseUrl)),
      ...providerEnv(inputs.provider, inputs.apiKey, baseURL),
    };
    console.log("Running: " + maskArgvForLog(argv).map(shellQuote).join(" "));
    const result = await runProcess(argv, { env, cwd: workspace });
    try {
      await writeFile(
        path.join(outputDir, "skilled-exit-code"),
        String(result.code),
      );
    } catch {}
    console.log(`skilled exit code: ${result.code}`);
    await setOutput("exit-code", result.code);
    await setOutput("report-dir", path.relative(workspace, outputDir));
    return result.code;
  } catch (e) {
    if (e instanceof ProcessExit) return e.code;
    console.error(`error: ${(e as Error).message}`);
    return 1;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  process.exitCode = await main();
