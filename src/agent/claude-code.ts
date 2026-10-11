// Modified for the skilled TypeScript distribution.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { context } from "@opentelemetry/api";
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
import {
  installMCPServers,
  buildClaudeCompatibleMCPInstallCmd,
} from "./mcp.js";
import {
  findAgentSessionJSONL,
  sessionCleanupOptions,
  withDownloadedSession,
} from "./session-lookup.js";
import {
  tracingEnabled,
  contextWithConfiguredAgentSpanAttributes,
} from "../observability/index.js";
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
import type { Message, Transcript } from "../contracts/transcript.js";
export class ClaudeCodeAgent extends CLIAgent {
  constructor(cfg: AgentConfig) {
    super({
      ...cfg,
      name: cfg.name || "claude-code",
      checkCmd: "command -v claude",
      versionCmd: "claude --version",
      skillPath: ".claude/skills",
    });
  }
  async install(rt: Runtime, signal?: AbortSignal): Promise<void> {
    await this.probeAndMergePATH(
      rt,
      `printf '%s' "$HOME/.local/bin:$HOME/.nvm/current/bin:$PATH"`,
      signal,
    );
    const r = await rt.exec(
      this.cfg.installCmd ||
        defaultClaudeCodeInstallCmdForVersion(this.cfg.version),
      this.mergeExecOptionsEnv({ cwd: "/", signal }, {}, {}),
    );
    if (r.exitCode !== 0)
      throw new Error(`install failed: agent installation failed: ${r.stderr}`);
  }
  async installMCP(
    rt: Runtime,
    cfg: MCPConfig,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!cfg.servers.length) return;
    await ensureNodeRuntime(rt, "claude", { signal });
    await installMCPServers(rt, cfg, buildClaudeMCPInstallCmd, signal);
  }
  async checkCredentials(_signal?: AbortSignal): Promise<void> {
    this.logCredentialStatus(
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_BASE_URL",
      "ANTHROPIC_API_KEY not set, claude-code will rely on existing login state if available",
    );
  }
  appliedModelName(): string {
    return this.cfg.modelName.trim();
  }
  claudeRunEnvVars(): Record<string, string> {
    const env = this.credentialEnvVars(
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_BASE_URL",
    );
    if (this.cfg.apiKey) env.ANTHROPIC_AUTH_TOKEN = this.cfg.apiKey;
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
    env.IS_SANDBOX = "1";
    if (tracingEnabled()) {
      env.CLAUDE_CODE_ENABLE_TELEMETRY = "1";
      env.CLAUDE_CODE_ENHANCED_TELEMETRY_BETA = "1";
      env.ENABLE_ENHANCED_TELEMETRY_BETA = "1";
    }
    return env;
  }
  async run(
    rt: Runtime,
    opts: ExecOptions,
    messages: Message[],
  ): Promise<SessionResult> {
    return this.execute(
      rt,
      opts,
      buildInstructionFromMessages(messages),
      randomUUID(),
      false,
    );
  }
  async runTurn(
    rt: Runtime,
    opts: ExecOptions,
    message: Message,
    sessionID: string,
  ): Promise<SessionResult> {
    if (!sessionID) return this.run(rt, opts, [message]);
    return this.execute(rt, opts, message.content ?? "", sessionID, true);
  }
  private async execute(
    rt: Runtime,
    opts: ExecOptions,
    instruction: string,
    sessionID: string,
    resume: boolean,
  ): Promise<SessionResult> {
    this.requireShell(rt);
    const start = Date.now();
    opts = this.mergeExecOptionsEnv(
      opts,
      this.claudeRunEnvVars(),
      this.buildAgentObservabilityAttrs({
        "claude_code.session_id": sessionID,
      }),
    );
    opts.context = contextWithConfiguredAgentSpanAttributes(
      opts.context ?? context.active(),
      opts.env ?? {},
    );
    let command: string, delivery;
    try {
      await ensureNodeRuntime(rt, "claude", opts);
      if (resume)
        command = buildClaudeResumeCmd(
          sessionID,
          this.appliedModelName(),
          instruction,
        );
      else {
        delivery = await deliverPrompt(rt, opts, instruction, {
          inline: (p) =>
            buildClaudePrintCmd(sessionID, this.appliedModelName(), p),
          stdinFile: (p) =>
            buildClaudePrintStdinCmd(sessionID, this.appliedModelName(), p),
        });
        command = delivery.command;
      }
    } catch (e) {
      const failed: SessionResult = {
        engine: this.name(),
        exit_code: 1,
        duration_ms: Date.now() - start,
        turns: 0,
        artifacts: {},
        ...(resume ? { session_id: sessionID } : {}),
      };
      this.annotateSessionResult(failed);
      throw new AgentExecutionError(String(e), failed, { cause: e });
    }
    let r: ExecResult, error: unknown;
    try {
      r = await rt.exec(command, opts);
    } catch (e) {
      error = e;
      r =
        e instanceof RuntimeExecutionError
          ? e.result
          : { stdout: "", stderr: "", exitCode: 1 };
    }
    const result = await this.buildSessionResult(
      rt,
      opts,
      instruction,
      start,
      r,
    );
    result.session_id = sessionID;
    if (delivery) result.prompt_delivery = delivery.metadata;
    this.annotateSessionResult(result);
    const provider = claudeProviderRunError(r, result);
    if (provider)
      throw new AgentExecutionError(provider.message, result, {
        cause: provider,
      });
    if (error)
      throw new AgentExecutionError(
        `claude-code ${resume ? "resume" : "run"} failed: ${String(error)}`,
        result,
        { cause: error },
      );
    if (r.exitCode !== 0)
      throw new AgentExecutionError(
        `claude-code ${resume ? "resume" : "run"} failed (exit ${r.exitCode}): ${r.stderr}`,
        result,
      );
    return result;
  }
  async buildSessionResult(
    rt: Runtime,
    opts: ExecOptions,
    instruction: string,
    start: number,
    result: ExecResult,
  ): Promise<SessionResult> {
    let parsed: ParsedClaude = {
      transcript: [],
      finalMsg: "",
      inputTokens: 0,
      outputTokens: 0,
    };
    const cleanup = sessionCleanupOptions(opts);
    let generated: string[] = [];
    try {
      const file = await persistSessionArtifact(
        rt,
        opts.artifactDir,
        "stdout.json",
        result.stdout,
        cleanup.signal,
      );
      if (!opts.artifactDir) generated.push(file);
    } catch {
      /* Source artifact collection is best effort. */
    }
    const found = await findClaudeSessionFile(rt, cleanup);
    const downloaded = await withDownloadedSession(
      rt,
      opts.artifactDir ?? "",
      found,
      generated,
      async (file) => {
        parsed = await parseSessionFile(file);
      },
      cleanup,
    );
    generated = downloaded.files;
    await downloaded.cleanup();
    if (!parsed.transcript.length && result.stdout.trim()) {
      parsed.transcript = [
        { role: "user", content: instruction, turn: 1 },
        { role: "assistant", content: result.stdout.trim(), turn: 1 },
      ];
      parsed.finalMsg = result.stdout.trim();
    }
    return {
      engine: this.name(),
      exit_code: result.exitCode,
      duration_ms: Date.now() - start,
      turns: countTurns(parsed.transcript),
      input_tokens: parsed.inputTokens,
      output_tokens: parsed.outputTokens,
      final_message: parsed.finalMsg,
      stderr: result.stderr,
      transcript: parsed.transcript,
      artifacts: { generated_files: generated },
    };
  }
  buildStreamJSON(messages: Message[]): string {
    return buildStreamJSON(messages);
  }
}
export const buildClaudeMCPInstallCmd = (server: MCPServerConfig): string =>
  buildClaudeCompatibleMCPInstallCmd("claude", "claude-code", server);
export const defaultClaudeCodeInstallCmd = (): string =>
  defaultClaudeCodeInstallCmdForVersion("");
export function defaultClaudeCodeInstallCmdForVersion(version: string): string {
  return [
    "set -e",
    installedVersionGuard("claude", version) ||
      "if command -v claude >/dev/null 2>&1; then exit 0; fi",
    ...nodeBootstrapLines(),
    "npm install -g --include=optional " +
      shellQuote(versionedPackage("@anthropic-ai/claude-code", version)),
  ].join("\n");
}
export function buildClaudePrintCmd(
  id: string,
  model: string,
  instruction: string,
): string {
  return (
    "claude --settings " +
    shellQuote('{"disableAllHooks":true}') +
    " --session-id " +
    id +
    " -p --permission-mode=bypassPermissions" +
    (model ? " --model " + shellQuote(model) : "") +
    " " +
    shellQuote(instruction)
  );
}
export function buildClaudePrintStdinCmd(
  id: string,
  model: string,
  file: string,
): string {
  return (
    "cat " +
    shellQuote(file) +
    " | claude --settings " +
    shellQuote('{"disableAllHooks":true}') +
    " --session-id " +
    id +
    " -p --permission-mode=bypassPermissions" +
    (model ? " --model " + shellQuote(model) : "")
  );
}
export function buildClaudeResumeCmd(
  id: string,
  model: string,
  instruction: string,
): string {
  return (
    "claude --settings " +
    shellQuote('{"disableAllHooks":true}') +
    " --resume " +
    id +
    " -p --permission-mode=bypassPermissions" +
    (model ? " --model " + shellQuote(model) : "") +
    " " +
    shellQuote(instruction)
  );
}
export function providerRateLimitText(text: string): string {
  const trimmed = text.trim(),
    scan = Buffer.from(trimmed).subarray(-2048).toString().toLowerCase();
  return [
    "模型提供方限流",
    "rate limit",
    "too many requests",
    "http 429",
    "status 429",
    "error 429",
    "code 429",
    "429 too many requests",
    "request limit reached",
  ].some((s) => scan.includes(s))
    ? trimmed
    : "";
}
export function providerAuthFailureText(text: string): string {
  const trimmed = text.trim(),
    scan = Buffer.from(trimmed).subarray(-4096).toString().toLowerCase(),
    compact = scan.replaceAll(": ", ":").replaceAll(" :", ":");
  return scan.includes("authentication_failed") ||
    scan.includes("authentication error") ||
    compact.includes('"api_error_status":403') ||
    compact.includes('"error_status":403')
    ? trimmed
    : "";
}
export function sessionDiagnosticText(result?: SessionResult | null): string {
  return result?.final_message || result?.stderr || "";
}
export function providerRateLimitSignal(
  exec: ExecResult,
  result?: SessionResult | null,
): string {
  return (
    [exec.stderr, exec.stdout, sessionDiagnosticText(result)]
      .map(providerRateLimitText)
      .find(Boolean) ?? ""
  );
}
export function providerAuthFailureSignal(
  exec: ExecResult,
  result?: SessionResult | null,
): string {
  return (
    [exec.stderr, exec.stdout, sessionDiagnosticText(result)]
      .map(providerAuthFailureText)
      .find(Boolean) ?? ""
  );
}
export function markSessionFailed(result?: SessionResult | null): void {
  if (result && result.exit_code === 0) result.exit_code = 1;
}
export function claudeProviderRunError(
  exec: ExecResult,
  result?: SessionResult | null,
): Error | undefined {
  const auth = providerAuthFailureSignal(exec, result);
  if (auth) {
    markSessionFailed(result);
    return new Error("claude-code authentication failed: " + auth);
  }
  const rate = providerRateLimitSignal(exec, result);
  if (rate) {
    markSessionFailed(result);
    return new Error("claude-code provider rate limit: " + rate);
  }
  return undefined;
}
export function buildClaudeTextSessionResult(
  engine: string,
  instruction: string,
  start: number,
  r: ExecResult,
): SessionResult {
  const final = r.stdout.trim();
  return {
    engine,
    exit_code: r.exitCode,
    duration_ms: Date.now() - start,
    turns: final ? 1 : 0,
    stderr: r.stderr,
    final_message: final,
    artifacts: { generated_files: ["stdout.json"] },
    ...(final
      ? {
          transcript: [
            { role: "user", content: instruction, turn: 1 },
            { role: "assistant", content: final, turn: 1 },
          ],
        }
      : {}),
  };
}
export function buildClaudePrintJSONSessionResult(
  engine: string,
  start: number,
  r: ExecResult,
): SessionResult {
  const res: SessionResult = {
    engine,
    exit_code: r.exitCode,
    duration_ms: Date.now() - start,
    turns: 0,
    stderr: r.stderr,
    artifacts: { generated_files: ["stdout.json"] },
  };
  let payload;
  try {
    payload = JSON.parse(r.stdout);
    if (
      payload !== null &&
      (typeof payload !== "object" || Array.isArray(payload))
    )
      throw new Error("invalid payload");
  } catch {
    res.final_message = r.stdout;
    if (r.stdout.trim()) {
      res.transcript = [{ role: "assistant", content: r.stdout, turn: 1 }];
      res.turns = 1;
    }
    return res;
  }
  res.final_message = payload?.result ?? "";
  res.turns = payload?.num_turns ?? 0;
  if (res.final_message?.trim()) {
    res.turns ||= 1;
    res.transcript = [
      { role: "assistant", content: res.final_message, turn: 1 },
    ];
  }
  if (payload?.is_error && res.exit_code === 0) res.exit_code = 1;
  return res;
}
export const findClaudeSessionFile = (
  rt: Runtime,
  opts: ExecOptions = {},
): Promise<string> =>
  findAgentSessionJSONL(
    rt,
    {
      projectsRootTmpl: "$home/.claude/projects",
      sessionDepth: 1,
      findExtra: "",
    },
    opts,
  );
export const claudeInputContentJSON = (content: unknown): string =>
  JSON.stringify(
    typeof content === "string" ? [{ type: "text", text: content }] : content,
  );
export function buildStreamJSON(messages: Message[]): string {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map(
      (m) =>
        `{"type":"${m.role}","message":{"role":"${m.role}","content":${claudeInputContentJSON(m.content ?? "")}}}\n`,
    )
    .join("");
}
export interface ParsedClaude {
  transcript: Transcript;
  finalMsg: string;
  inputTokens: number;
  outputTokens: number;
}
interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}
interface ClaudeEvent {
  type?: string;
  message?: { content?: unknown; usage?: Usage };
  tool_call?: { id?: string; name: string; input?: Record<string, unknown> };
  tool_result?: { call_id?: string; status?: string; content?: unknown };
  result?: string;
  usage?: Usage;
  final_message?: { content: string };
  isApiErrorMessage?: boolean;
}
export function sessionUsageInputTotal(u: Usage = {}): number {
  return (
    (u.input_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0)
  );
}
export function contentBlockToString(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}
function contentBlocks(content: unknown): Record<string, unknown>[] {
  return Array.isArray(content)
    ? content.filter((v) => v && typeof v === "object" && !Array.isArray(v))
    : [];
}
export function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  return contentBlocks(content)
    .flatMap((b) =>
      b.type === "text" && typeof b.text === "string"
        ? [b.text]
        : b.type === "tool_use" && typeof b.name === "string"
          ? ["[tool: " + b.name + "]"]
          : [],
    )
    .join("\n\n");
}
export function extractAssistantTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  return contentBlocks(content)
    .flatMap((b) =>
      b.type === "text" && typeof b.text === "string" ? [b.text] : [],
    )
    .join("\n\n");
}
export function extractToolMessagesFromContent(
  content: unknown,
  turn: number,
): Transcript {
  const out: Transcript = [];
  for (const b of contentBlocks(content)) {
    if (b.type === "tool_use")
      out.push({
        role: "tool_call",
        turn,
        tool_call: {
          id: typeof b.id === "string" ? b.id : "",
          name: typeof b.name === "string" ? b.name : "",
          arguments:
            b.input && typeof b.input === "object" && !Array.isArray(b.input)
              ? (b.input as Record<string, unknown>)
              : undefined,
        },
      });
    if (b.type === "tool_result")
      out.push({
        role: "tool_result",
        turn,
        tool_result: {
          call_id: typeof b.tool_use_id === "string" ? b.tool_use_id : "",
          status: b.is_error === true ? "error" : "success",
          content: contentBlockToString(b.content),
        },
      });
  }
  return out;
}
function eventTools(e: ClaudeEvent, turn: number): Transcript {
  if (e.type === "tool_call" && e.tool_call)
    return [
      {
        role: "tool_call",
        turn,
        tool_call: {
          id: e.tool_call.id,
          name: e.tool_call.name,
          arguments: e.tool_call.input,
        },
      },
    ];
  if (e.type === "tool_result" && e.tool_result)
    return [{ role: "tool_result", turn, tool_result: e.tool_result }];
  return [];
}
export function countTurns(trans: Transcript | null | undefined): number {
  return trans?.filter((m) => m.role === "assistant").length ?? 0;
}
function jsonLines(output: string): ClaudeEvent[] {
  const out: ClaudeEvent[] = [];
  for (const raw of output.split("\n")) {
    if (Buffer.byteLength(raw) >= 1024 * 1024) break;
    const line = raw.trim();
    if (!line || line === "[]" || line === "{}") continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === "object" && !Array.isArray(e)) out.push(e);
    } catch {
      /* malformed source records are ignored */
    }
  }
  return out;
}
export function parseStreamOutput(output: string): ParsedClaude {
  const out: ParsedClaude = {
    transcript: [],
    finalMsg: "",
    inputTokens: 0,
    outputTokens: 0,
  };
  let events = jsonLines(output),
    turn = 0;
  try {
    if (output.trim().startsWith("[")) {
      const array = JSON.parse(output);
      if (Array.isArray(array)) events = array;
    }
  } catch {}
  for (const e of events) {
    if (!e) continue;
    if (e.type === "user") {
      turn++;
      if (e.message)
        out.transcript.push({
          role: "user",
          content: extractTextFromContent(e.message.content),
          turn,
        });
    }
    if (e.type === "assistant" && e.message) {
      out.transcript.push({
        role: "assistant",
        content: extractTextFromContent(e.message.content),
        turn,
      });
      const n = sessionUsageInputTotal(e.message.usage);
      if (n > 0) out.inputTokens = n;
      if ((e.message.usage?.output_tokens ?? 0) > 0)
        out.outputTokens = e.message.usage!.output_tokens!;
    }
    out.transcript.push(...eventTools(e, turn));
    if (e.type === "result") {
      if (e.result) out.finalMsg = e.result;
      const n = sessionUsageInputTotal(e.usage);
      if (n > 0) out.inputTokens = n;
      if ((e.usage?.output_tokens ?? 0) > 0)
        out.outputTokens = e.usage!.output_tokens!;
    }
  }
  normalizeTranscript(out.transcript);
  return out;
}
export async function parseSessionFile(file: string): Promise<ParsedClaude> {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return { transcript: [], finalMsg: "", inputTokens: 0, outputTokens: 0 };
  }
  return parseSessionJSONL(text);
}
export function parseSessionJSONL(text: string): ParsedClaude {
  const out: ParsedClaude = {
    transcript: [],
    finalMsg: "",
    inputTokens: 0,
    outputTokens: 0,
  };
  let turn = 0;
  for (const e of jsonLines(text)) {
    if (e.type === "user") {
      turn++;
      if (e.message) {
        const prose = extractTextFromContent(e.message.content);
        if (prose) out.transcript.push({ role: "user", content: prose, turn });
        out.transcript.push(
          ...extractToolMessagesFromContent(e.message.content, turn),
        );
      }
    } else if (e.type === "assistant" && e.message) {
      out.transcript.push(
        ...extractToolMessagesFromContent(e.message.content, turn),
      );
      const prose = extractAssistantTextFromContent(e.message.content);
      if (prose)
        out.transcript.push({
          role: e.isApiErrorMessage ? "error" : "assistant",
          content: prose,
          turn,
        });
      out.inputTokens = Math.max(
        out.inputTokens,
        sessionUsageInputTotal(e.message.usage),
      );
      out.outputTokens = Math.max(
        out.outputTokens,
        e.message.usage?.output_tokens ?? 0,
      );
    } else if (e.type === "result" && e.final_message?.content)
      out.finalMsg = e.final_message.content;
    else if (e.type === "error" && e.isApiErrorMessage && e.message)
      out.transcript.push({
        role: "error",
        content: extractTextFromContent(e.message.content),
        turn,
      });
    out.transcript.push(...eventTools(e, turn));
  }
  if (!out.finalMsg)
    out.finalMsg =
      out.transcript.findLast((m) => m.role === "assistant" && m.content)
        ?.content ?? "";
  normalizeTranscript(out.transcript);
  return out;
}
export const mapsClone = (
  map: Record<string, string> | null,
): Record<string, string> | null => (map ? { ...map } : null);

export function normalizeTranscript(transcript: Transcript): void {
  for (const m of transcript) {
    if (!m.turn) delete m.turn;
    if (!m.content) delete m.content;
    if (m.tool_call) {
      if (!m.tool_call.id) delete m.tool_call.id;
      if (!m.tool_call.arguments || !Object.keys(m.tool_call.arguments).length)
        delete m.tool_call.arguments;
    }
    if (m.tool_result) {
      if (!m.tool_result.call_id) delete m.tool_result.call_id;
      if (!m.tool_result.status) delete m.tool_result.status;
      if (m.tool_result.content == null) delete m.tool_result.content;
    }
  }
}
