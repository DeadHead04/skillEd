// Modified for the skilled TypeScript distribution.
import { omitEmptyTranscriptFields } from "./tool-status.js";
import { AgentExecutionError } from "./errors.js";
import { createReadStream } from "node:fs";
import { CLIAgent } from "./cli.js";
import { contentBlockToString, countTurns } from "./claude-code.js";
import {
  buildInstructionFromMessages,
  requireBashTargetShell,
  shellQuote,
  persistSessionArtifact,
  installedVersionGuard,
  versionedPackage,
} from "./base.js";
import { ensureNodeRuntime, nodeBootstrapLines } from "./node-install.js";
import { deliverPrompt } from "./prompt-delivery.js";
import {
  installMCPServers,
  buildClaudeCompatibleMCPInstallCmd,
} from "./mcp.js";
import {
  findAgentSessionJSONL,
  withDownloadedSession,
  sessionCleanupOptions,
} from "./session-lookup.js";
import {
  finalAssistantMessage,
  type Message,
  type Transcript,
} from "../contracts/transcript.js";
import { contextWithConfiguredAgentSpanAttributes } from "../observability/index.js";
import { ROOT_CONTEXT } from "@opentelemetry/api";
import type {
  Config,
  Runtime,
  ExecOptions,
  ExecResult,
  SessionResult,
  MCPConfig,
} from "./types.js";
import type { MCPServerConfig } from "../runtime/types.js";
import { RuntimeExecutionError } from "../runtime/types.js";
export const qwenCodeEngineName = "qwen_code",
  qwenCodePackage = "@qwen-code/qwen-code",
  qwenCodeBinary = "qwen";
export const qwenCodeExecPathProbeCmd = `printf '%s' "$HOME/.local/bin:$HOME/.nvm/current/bin:$PATH"`;
export interface QwenSessionEvent {
  type?: string;
  model?: string;
  message?: { role?: string; parts?: QwenSessionPart[] };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
    totalTokenCount?: number;
  };
}
export interface QwenSessionPart {
  text?: string;
  thought?: boolean;
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name?: string; response?: unknown };
}
export interface QwenParseResult {
  transcript: Transcript;
  finalMsg: string;
  inputTokens: number;
  outputTokens: number;
}
export function appendQwenMessageParts(
  messages: Transcript,
  event: QwenSessionEvent,
  turn: number,
): string {
  const role = event.type === "user" ? "user" : "assistant",
    texts: string[] = [];
  for (const part of event.message?.parts ?? []) {
    if (part == null) continue;
    if (part.thought) continue;
    if (part.functionCall) {
      messages.push({
        role: "tool_call",
        tool_call: {
          id: part.functionCall.id ?? "",
          name: part.functionCall.name ?? "",
          ...(part.functionCall.args
            ? { arguments: part.functionCall.args }
            : {}),
        },
        turn,
      });
    } else if (part.functionResponse) {
      messages.push({
        role: "tool_result",
        tool_result: {
          call_id: part.functionResponse.id ?? "",
          status: "success",
          content: contentBlockToString(part.functionResponse.response),
        },
        turn,
      });
    } else if (part.text) texts.push(part.text);
  }
  if (!texts.length) return "";
  const content = texts.join("\n\n");
  messages.push({ role, content, turn });
  return role === "assistant" ? content : "";
}
function validQwenEvent(value: unknown): value is QwenSessionEvent {
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const strings = (v: Record<string, unknown>, keys: string[]) =>
    keys.every((k) => v[k] == null || typeof v[k] === "string");
  if (!object(value) || !strings(value, ["type", "model"])) return false;
  if (
    value.usageMetadata != null &&
    (!object(value.usageMetadata) ||
      [
        "promptTokenCount",
        "candidatesTokenCount",
        "thoughtsTokenCount",
        "cachedContentTokenCount",
        "totalTokenCount",
      ].some(
        (k) =>
          value.usageMetadata != null &&
          (value.usageMetadata as Record<string, unknown>)[k] != null &&
          !Number.isInteger(
            (value.usageMetadata as Record<string, unknown>)[k],
          ),
      ))
  )
    return false;
  if (value.message != null) {
    if (!object(value.message) || !strings(value.message, ["role"]))
      return false;
    const parts = value.message.parts;
    if (parts != null) {
      if (!Array.isArray(parts)) return false;
      for (const p of parts) {
        if (p == null) continue;
        if (
          !object(p) ||
          !strings(p, ["text"]) ||
          (p.thought != null && typeof p.thought !== "boolean")
        )
          return false;
        for (const key of ["functionCall", "functionResponse"]) {
          const fn = p[key];
          if (
            fn != null &&
            (!object(fn) ||
              !strings(fn, ["id", "name"]) ||
              (key === "functionCall" && fn.args != null && !object(fn.args)))
          )
            return false;
        }
      }
    }
  }
  return true;
}
function qwenSessionParser() {
  const result: QwenParseResult = {
    transcript: [],
    finalMsg: "",
    inputTokens: 0,
    outputTokens: 0,
  };
  let turn = 0;
  return {
    apply(line0: string) {
      const line = line0.trim();
      if (!line || line === "[]" || line === "{}") return;
      let event: QwenSessionEvent;
      try {
        event = JSON.parse(line);
        if (!validQwenEvent(event)) return;
      } catch {
        return;
      }
      if (event.type === "user") turn++;
      if (!event.message) return;
      const final = appendQwenMessageParts(
        result.transcript,
        event,
        Math.max(turn, 1),
      );
      if (final) result.finalMsg = final;
      if (event.type === "assistant" && event.usageMetadata) {
        result.inputTokens = Math.max(
          result.inputTokens,
          event.usageMetadata.promptTokenCount ?? 0,
        );
        result.outputTokens = Math.max(
          result.outputTokens,
          (event.usageMetadata.candidatesTokenCount ?? 0) +
            (event.usageMetadata.thoughtsTokenCount ?? 0),
        );
      }
    },
    finish() {
      result.finalMsg ||= finalAssistantMessage(result.transcript);
      omitEmptyTranscriptFields(result.transcript);
      return result;
    },
  };
}
export function parseQwenSessionOutput(output: string): QwenParseResult {
  const parser = qwenSessionParser();
  for (const line of output.split("\n")) {
    if (Buffer.byteLength(line) >= 1024 * 1024) break;
    parser.apply(line);
  }
  return parser.finish();
}
export async function parseQwenSessionFile(
  file: string,
): Promise<QwenParseResult> {
  const parser = qwenSessionParser();
  const input = createReadStream(file);
  let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  try {
    for await (const chunk of input) {
      const buffer = Buffer.concat([pending, chunk as Buffer]);
      let start = 0;
      while (true) {
        const end = buffer.indexOf(10, start);
        if (end < 0) break;
        if (end - start >= 1024 * 1024) return parser.finish();
        parser.apply(buffer.subarray(start, end).toString("utf8"));
        start = end + 1;
      }
      pending = buffer.subarray(start);
      if (pending.length >= 1024 * 1024) return parser.finish();
    }
    if (pending.length) parser.apply(pending.toString("utf8"));
  } catch {
  } finally {
    input.destroy();
  }
  return parser.finish();
}
export function buildQwenCodeRunCmd(
  instruction: string,
  model: string,
): string {
  return (
    `printf '%s' ${shellQuote(instruction)} | qwen --yolo` +
    (model ? " -m " + shellQuote(model) : "")
  );
}
export function buildQwenCodeRunStdinCmd(
  promptPath: string,
  model: string,
): string {
  return (
    "cat " +
    shellQuote(promptPath) +
    " | qwen --yolo" +
    (model ? " -m " + shellQuote(model) : "")
  );
}
export function defaultQwenCodeInstallCmdForVersion(version = ""): string {
  return [
    "set -e",
    installedVersionGuard("qwen", version) ||
      "if command -v qwen >/dev/null 2>&1; then exit 0; fi",
    ...nodeBootstrapLines("22"),
    "npm install -g " + shellQuote(versionedPackage(qwenCodePackage, version)),
  ].join("\n");
}
export const defaultQwenCodeInstallCmd = () =>
  defaultQwenCodeInstallCmdForVersion();
export const buildQwenCodeMCPInstallCmd = (server: MCPServerConfig): string =>
  buildClaudeCompatibleMCPInstallCmd("qwen", "qwen_code", server);
export const findQwenCodeSessionFile = (
  rt: Runtime,
  opts: ExecOptions = {},
): Promise<string> =>
  findAgentSessionJSONL(
    rt,
    { projectsRootTmpl: "$home/.qwen/projects", sessionDepth: 2 },
    opts,
  );
export class QwenCodeAgent extends CLIAgent {
  constructor(cfg: Config) {
    super({
      ...cfg,
      name: cfg.name || qwenCodeEngineName,
      checkCmd: cfg.checkCmd || "command -v qwen",
      versionCmd: cfg.versionCmd || "qwen --version",
      skillPath: cfg.skillPath || ".qwen/skills",
    });
  }
  async install(rt: Runtime, signal?: AbortSignal): Promise<void> {
    await this.probeAndMergePATH(rt, qwenCodeExecPathProbeCmd, signal);
    const opts = this.mergeExecOptionsEnv({ cwd: "/", signal }, {}, {});
    const result = await rt.exec(
      this.cfg.installCmd ||
        defaultQwenCodeInstallCmdForVersion(this.cfg.version),
      opts,
    );
    if (result.exitCode !== 0)
      throw new Error("install failed: agent install failed: " + result.stderr);
  }
  async installMCP(
    rt: Runtime,
    config: MCPConfig,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!config.servers.length) return;
    await ensureNodeRuntime(rt, "qwen", { signal });
    await installMCPServers(rt, config, buildQwenCodeMCPInstallCmd, signal);
  }
  async checkCredentials(): Promise<void> {
    this.logCredentialStatus(
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
      "OPENAI_API_KEY not set, qwen_code will rely on existing login state if available",
    );
  }
  async run(
    rt: Runtime,
    opts: ExecOptions,
    messages: Message[],
  ): Promise<SessionResult> {
    requireBashTargetShell(rt);
    const start = performance.now(),
      instruction = buildInstructionFromMessages(messages),
      model = this.cfg.modelName.trim();
    const env = this.credentialEnvVars("OPENAI_API_KEY", "OPENAI_BASE_URL");
    if (model) env.OPENAI_MODEL = model;
    if (!rt.requiresProcessSandbox()) env.QWEN_CODE_SUPPRESS_YOLO_WARNING = "1";
    opts = this.mergeExecOptionsEnv(
      opts,
      env,
      this.buildAgentObservabilityAttrs(),
    );
    opts.context = contextWithConfiguredAgentSpanAttributes(
      opts.context ?? ROOT_CONTEXT,
      opts.env ?? {},
    );
    let delivery;
    try {
      await ensureNodeRuntime(rt, "qwen", opts);
      delivery = await deliverPrompt(rt, opts, instruction, {
        inline: (p) => buildQwenCodeRunCmd(p, model),
        stdinFile: (p) => buildQwenCodeRunStdinCmd(p, model),
      });
    } catch (e) {
      const result = {
        engine: this.name(),
        exit_code: 1,
        duration_ms: Math.floor(performance.now() - start),
        turns: 0,
        artifacts: {},
      };
      this.annotateSessionResult(result);
      throw new AgentExecutionError(String(e), result, { cause: e });
    }
    let execution: ExecResult, error: unknown;
    try {
      execution = await rt.exec(delivery.command, opts);
    } catch (e) {
      error = e;
      execution =
        e instanceof RuntimeExecutionError
          ? e.result
          : { stdout: "", stderr: "", exitCode: 1 };
    }
    const result = await this.buildSessionResult(
      rt,
      opts,
      instruction,
      start,
      execution,
    );
    result.prompt_delivery = delivery.metadata;
    this.annotateSessionResult(result);
    if (error || execution.exitCode !== 0)
      throw new AgentExecutionError(
        error
          ? `qwen_code run failed: ${String(error)}`
          : `qwen_code run failed (exit ${execution.exitCode}): ${execution.stderr}`,
        result,
        { cause: error },
      );
    return result;
  }
  async buildSessionResult(
    rt: Runtime,
    opts: ExecOptions,
    instruction: string,
    start: number,
    execution: ExecResult,
  ): Promise<SessionResult> {
    const cleanupOpts = sessionCleanupOptions(opts);
    let parsed: QwenParseResult = {
        transcript: [],
        finalMsg: "",
        inputTokens: 0,
        outputTokens: 0,
      },
      files: string[] = [];
    try {
      const artifact = await persistSessionArtifact(
        rt,
        opts.artifactDir ?? "",
        "stdout.txt",
        execution.stdout,
        cleanupOpts.signal,
      );
      if (!opts.artifactDir) files.push(artifact);
    } catch {}
    const downloaded = await withDownloadedSession(
      rt,
      opts.artifactDir ?? "",
      await findQwenCodeSessionFile(rt, cleanupOpts),
      files,
      async (p) => {
        parsed = await parseQwenSessionFile(p);
      },
      cleanupOpts,
    );
    try {
      files = downloaded.files;
      if (!parsed.transcript.length && execution.stdout.trim()) {
        parsed.transcript = [
          { role: "user", content: instruction, turn: 1 },
          { role: "assistant", content: execution.stdout.trim(), turn: 1 },
        ];
        parsed.finalMsg = execution.stdout.trim();
      }
      parsed.finalMsg ||= finalAssistantMessage(parsed.transcript);
      return {
        engine: this.name(),
        exit_code: execution.exitCode,
        duration_ms: Math.floor(performance.now() - start),
        turns: countTurns(parsed.transcript),
        input_tokens: parsed.inputTokens,
        output_tokens: parsed.outputTokens,
        final_message: parsed.finalMsg,
        stderr: execution.stderr,
        transcript: parsed.transcript,
        artifacts: { generated_files: files },
      };
    } finally {
      await downloaded.cleanup();
    }
  }
}
