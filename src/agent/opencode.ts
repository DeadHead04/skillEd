// Modified for the skilled TypeScript distribution.
import { context } from "@opentelemetry/api";
import { normalizeTranscript } from "./claude-code.js";
import { CLIAgent } from "./cli.js";
import {
  shellQuote,
  installedVersionGuard,
  versionedPackage,
  requireBashTargetShell,
  buildInstructionFromMessages,
  persistSessionArtifact,
} from "./base.js";
import { ensureNodeRuntime, nodeBootstrapLines } from "./node-install.js";
import { deliverPrompt } from "./prompt-delivery.js";
import { shellEnvNamePattern } from "./mcp.js";
import { sessionCleanupOptions } from "./session-lookup.js";
import { contextWithConfiguredAgentSpanAttributes } from "../observability/index.js";
import { RuntimeExecutionError } from "../runtime/types.js";
import { AgentExecutionError } from "./errors.js";
import type {
  AgentConfig,
  Runtime,
  ExecOptions,
  ExecResult,
  MCPConfig,
  SessionResult,
} from "./types.js";
import type { MCPServerConfig } from "../runtime/types.js";
import type { Message } from "../contracts/transcript.js";
export class OpenCodeAgent extends CLIAgent {
  constructor(cfg: AgentConfig) {
    super({
      ...cfg,
      name: cfg.name || "opencode",
      checkCmd: cfg.checkCmd || "command -v opencode",
      versionCmd: cfg.versionCmd || "opencode --version",
      skillPath: cfg.skillPath || ".opencode/skills",
    });
  }
  async install(rt: Runtime, signal?: AbortSignal): Promise<void> {
    await this.probeAndMergePATH(
      rt,
      `printf '%s' "$HOME/.local/bin:$HOME/.nvm/current/bin:$HOME/.opencode/bin:$PATH"`,
      signal,
    );
    const r = await rt.exec(
      this.cfg.installCmd ||
        defaultOpenCodeInstallCmdForVersion(this.cfg.version),
      this.mergeExecOptionsEnv({ cwd: "/", signal }, {}, {}),
    );
    if (r.exitCode !== 0)
      throw new Error(`install failed: agent installation failed: ${r.stderr}`);
  }
  async checkCredentials(_signal?: AbortSignal): Promise<void> {
    const provider =
      this.cfg.modelProvider === "anthropic" ||
      this.cfg.protocol === "anthropic"
        ? "ANTHROPIC"
        : "OPENAI";
    this.logCredentialStatus(
      provider + "_API_KEY",
      provider + "_BASE_URL",
      provider +
        "_API_KEY not set, opencode will rely on existing login state if available",
    );
  }
  async installMCP(
    rt: Runtime,
    cfg: MCPConfig,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!cfg.servers.length && !this.cfg.baseURL) return;
    const servers: Record<string, unknown> = {},
      env: Record<string, string> = {};
    for (const [i, server] of cfg.servers.entries()) {
      const resolved = openCodeMCPServer(server, i);
      servers[server.name] = resolved.entry;
      Object.assign(env, resolved.env);
    }
    const value = await readOpenCodeRuntimeConfig(rt, signal);
    if (Object.keys(servers).length)
      value.mcp = { ...objectMap(value.mcp), ...servers };
    if (this.cfg.baseURL) {
      const p = this.providerConfig();
      value.provider = { ...objectMap(value.provider), [p.provider]: p.entry };
      Object.assign(env, p.env);
    }
    if (!Object.keys(value).length) return;
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify(value);
    rt.mergeEnv(env);
  }
  providerConfig(): {
    provider: string;
    entry: Record<string, unknown>;
    env: Record<string, string>;
  } {
    const provider = this.cfg.modelProvider || "openai",
      options: Record<string, unknown> = { baseURL: this.cfg.baseURL },
      entry: Record<string, unknown> = { options },
      env: Record<string, string> = {};
    if (provider === "openai" || provider === "anthropic")
      return { provider, entry, env };
    entry.npm =
      this.cfg.protocol === "anthropic"
        ? "@ai-sdk/anthropic"
        : "@ai-sdk/openai-compatible";
    if (this.cfg.modelName) entry.models = { [this.cfg.modelName]: {} };
    if (this.cfg.apiKey) {
      options.apiKey = "{env:SKILLED_OPENCODE_API_KEY}";
      env.SKILLED_OPENCODE_API_KEY = this.cfg.apiKey;
    }
    return { provider, entry, env };
  }
  model(): string {
    const model = this.cfg.modelName.trim();
    if (!model) return "";
    const provider = this.cfg.modelProvider.trim();
    return provider
      ? provider + "/" + model
      : this.cfg.baseURL
        ? "openai/" + model
        : model;
  }
  async run(
    rt: Runtime,
    opts: ExecOptions,
    messages: Message[],
  ): Promise<SessionResult> {
    return this.execute(rt, opts, buildInstructionFromMessages(messages), "");
  }
  async runTurn(
    rt: Runtime,
    opts: ExecOptions,
    message: Message,
    id: string,
  ): Promise<SessionResult> {
    return this.execute(rt, opts, message.content ?? "", id);
  }
  requiresSessionIDForNextTurn(): boolean {
    return true;
  }
  returnsIncrementalSessionResults(): boolean {
    return true;
  }
  async execute(
    rt: Runtime,
    opts: ExecOptions,
    instruction: string,
    sessionID: string,
  ): Promise<SessionResult> {
    this.requireShell(rt);
    const start = Date.now(),
      env = this.credentialEnvVars("", "");
    if (this.cfg.apiKey)
      env[
        this.cfg.modelProvider === "anthropic" ||
        this.cfg.protocol === "anthropic"
          ? "ANTHROPIC_API_KEY"
          : "OPENAI_API_KEY"
      ] = this.cfg.apiKey;
    opts = this.mergeExecOptionsEnv(
      opts,
      env,
      this.buildAgentObservabilityAttrs(),
    );
    opts.context = contextWithConfiguredAgentSpanAttributes(
      opts.context ?? context.active(),
      opts.env ?? {},
    );
    let delivery;
    try {
      await ensureNodeRuntime(rt, "opencode", opts);
      delivery = await deliverPrompt(rt, opts, instruction, {
        inline: (p) => buildOpenCodeRunCmd(p, this.model(), sessionID),
        stdinFile: (p) =>
          buildOpenCodeRunCmd("", this.model(), sessionID) +
          ' -- "$(cat ' +
          shellQuote(p) +
          ')"',
      });
    } catch (e) {
      const result: SessionResult = {
        engine: this.name(),
        exit_code: 1,
        duration_ms: 0,
        turns: 0,
        artifacts: {},
      };
      this.annotateSessionResult(result);
      throw new AgentExecutionError(String(e), result, { cause: e });
    }
    let exec: ExecResult, error: unknown;
    try {
      exec = await rt.exec(delivery.command, opts);
    } catch (e) {
      error = e;
      exec =
        e instanceof RuntimeExecutionError
          ? e.result
          : { stdout: "", stderr: "", exitCode: 1 };
    }
    const { result, eventError } = parseOpenCodeEvents(
      exec.stdout,
      instruction,
    );
    Object.assign(result, {
      engine: this.name(),
      exit_code: exec.exitCode,
      duration_ms: Date.now() - start,
      stderr: exec.stderr,
      prompt_delivery: delivery.metadata,
      artifacts: {},
    });
    const cleanup = sessionCleanupOptions(opts);
    try {
      const file = await persistSessionArtifact(
        rt,
        opts.artifactDir,
        "stdout.jsonl",
        exec.stdout,
        cleanup.signal,
      );
      if (!opts.artifactDir) result.artifacts!.generated_files = [file];
    } catch {}
    this.annotateSessionResult(result);
    if (error) {
      result.exit_code ||= 1;
      throw new AgentExecutionError(
        `opencode run failed: ${String(error)}`,
        result,
        { cause: error },
      );
    }
    if (exec.exitCode !== 0)
      throw new AgentExecutionError(
        `opencode run failed (exit ${exec.exitCode}): ${exec.stderr}`,
        result,
      );
    if (eventError) {
      result.exit_code = 1;
      throw new AgentExecutionError(
        "opencode run failed: " + eventError,
        result,
      );
    }
    if (!result.final_message) {
      result.exit_code = 1;
      throw new AgentExecutionError(
        "opencode run returned no assistant text",
        result,
      );
    }
    return result;
  }
}
function objectMap(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function defaultOpenCodeInstallCmdForVersion(version: string): string {
  return [
    "set -e",
    installedVersionGuard("opencode", version) ||
      "if command -v opencode >/dev/null 2>&1; then exit 0; fi",
    ...nodeBootstrapLines(),
    "npm install -g " + shellQuote(versionedPackage("opencode-ai", version)),
  ].join("\n");
}
export async function readOpenCodeRuntimeConfig(
  rt: Runtime,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const r = await rt.exec(`printf '%s' "$OPENCODE_CONFIG_CONTENT"`, { signal });
  if (r.exitCode !== 0)
    throw new Error(
      `read runtime OpenCode configuration (exit ${r.exitCode}): ${r.stderr}`,
    );
  if (!r.stdout) return {};
  let value;
  try {
    value = JSON.parse(r.stdout);
  } catch (e) {
    throw new Error("parse OPENCODE_CONFIG_CONTENT: " + String(e), {
      cause: e,
    });
  }
  if (value === null) return {};
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("parse OPENCODE_CONFIG_CONTENT: expected object");
  return value;
}
export function openCodeEnvRefs(
  value: string,
  refs: Record<string, string>,
): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_match, name: string) => "{env:" + (refs[name] || name) + "}",
  );
}
export function openCodeMCPServer(
  server: MCPServerConfig,
  index: number,
): { entry: Record<string, unknown>; env: Record<string, string> } {
  if (!server.name) throw new Error("opencode MCP server name is required");
  const env: Record<string, string> = {},
    refs: Record<string, string> = {};
  for (const [key, value] of Object.entries(server.env ?? {})) {
    if (!shellEnvNamePattern.test(key))
      throw new Error(
        `mcp server ${JSON.stringify(server.name)} env ${JSON.stringify(key)} is invalid`,
      );
    const ref = `SKILLED_OPENCODE_MCP_${index}_${key}`;
    refs[key] = ref;
    env[ref] = value;
  }
  if (server.transport === "stdio") {
    if (!server.command)
      throw new Error(
        `mcp server ${JSON.stringify(server.name)} stdio transport requires command`,
      );
    return {
      entry: {
        type: "local",
        command: [server.command, ...(server.args ?? [])],
        environment: Object.fromEntries(
          Object.entries(refs).map(([k, v]) => [k, "{env:" + v + "}"]),
        ),
      },
      env,
    };
  }
  if (!server.transport || server.transport === "http") {
    if (!server.endpoint)
      throw new Error(
        `mcp server ${JSON.stringify(server.name)} http transport requires endpoint`,
      );
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(server.headers ?? {}))
      headers[key] = openCodeEnvRefs(value, refs);
    for (const [key, value] of Object.entries(server.headerEnv ?? {})) {
      if (!shellEnvNamePattern.test(value))
        throw new Error(
          `mcp server ${JSON.stringify(server.name)} header environment ${JSON.stringify(value)} is invalid`,
        );
      headers[key] = "{env:" + (refs[value] || value) + "}";
    }
    return {
      entry: {
        type: "remote",
        url: openCodeEnvRefs(server.endpoint, refs),
        headers,
      },
      env,
    };
  }
  throw new Error(
    `mcp server ${JSON.stringify(server.name)} transport ${JSON.stringify(server.transport)} is not supported by opencode`,
  );
}
export function buildOpenCodeRunCmd(
  instruction: string,
  model: string,
  sessionID: string,
): string {
  return (
    "opencode run --format json --dangerously-skip-permissions" +
    (model ? " --model " + shellQuote(model) : "") +
    (sessionID ? " --session " + shellQuote(sessionID) : "") +
    (instruction ? " -- " + shellQuote(instruction) : "")
  );
}
interface OpenCodeEvent {
  type?: string;
  sessionID?: string;
  error?: { name?: string; data?: { message?: string } };
  part?: {
    text?: string;
    tool?: string;
    callID?: string;
    state?: {
      status?: string;
      input?: Record<string, unknown>;
      output?: string;
      error?: string;
    };
    tokens?: { input?: number; output?: number };
  };
}
/** Decode each concatenated JSON value on a line; stop at malformed input as encoding/json.Decoder does. */
export function decodeJSONValues(line: string): unknown[] {
  const values: unknown[] = [];
  let start = 0;
  while (start < line.length) {
    while (/\s/.test(line[start] ?? "") && start < line.length) start++;
    if (start === line.length) break;
    let depth = 0,
      quoted = false,
      escape = false,
      end = start;
    for (; end < line.length; end++) {
      const c = line[end];
      if (quoted) {
        if (escape) escape = false;
        else if (c === "\\") escape = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) {
          end++;
          break;
        }
      }
    }
    try {
      values.push(JSON.parse(line.slice(start, end)));
    } catch {
      break;
    }
    start = end;
  }
  return values;
}
export function parseOpenCodeEvents(
  output: string,
  instruction: string,
): { result: SessionResult; eventError: string } {
  const result: SessionResult = {
      exit_code: 0,
      duration_ms: 0,
      turns: 0,
      input_tokens: 0,
      output_tokens: 0,
      transcript: [{ role: "user", content: instruction, turn: 1 }],
    },
    texts: string[] = [];
  let eventError = "";
  for (const line of output.split("\n"))
    for (const value of decodeJSONValues(line)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const e = value as OpenCodeEvent,
        p = e.part ?? {},
        s = p.state ?? {};
      if (e.sessionID) result.session_id = e.sessionID;
      if (e.type === "error") {
        eventError = e.error?.data?.message || e.error?.name || "";
        result.transcript!.push({
          role: "error",
          content: eventError,
          turn: 1,
        });
      } else if (e.type === "text" && p.text) {
        texts.push(p.text);
        result.transcript!.push({
          role: "assistant",
          content: p.text,
          turn: 1,
        });
      } else if (e.type === "tool_use") {
        result.transcript!.push({
          role: "tool_call",
          turn: 1,
          tool_call: { id: p.callID, name: p.tool ?? "", arguments: s.input },
        });
        if (s.status === "completed" || s.status === "error")
          result.transcript!.push({
            role: "tool_result",
            turn: 1,
            tool_result: {
              call_id: p.callID,
              status: s.status === "error" ? "error" : "success",
              content:
                s.status === "error" ? (s.error ?? "") : (s.output ?? ""),
            },
          });
      } else if (e.type === "step_finish") {
        result.input_tokens! += p.tokens?.input ?? 0;
        result.output_tokens! += p.tokens?.output ?? 0;
      }
    }
  result.final_message = texts.join("\n");
  if (result.final_message) result.turns = 1;
  else delete result.final_message;
  if (!result.input_tokens) delete result.input_tokens;
  if (!result.output_tokens) delete result.output_tokens;
  normalizeTranscript(result.transcript!);
  return { result, eventError };
}
