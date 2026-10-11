// Modified for the skilled TypeScript distribution.
import { omitEmptyTranscriptFields } from "./tool-status.js";
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { ROOT_CONTEXT } from "@opentelemetry/api";
import { CLIAgent } from "./cli.js";
import {
  requireBashTargetShell,
  shellQuote,
  buildInstructionFromMessages,
  installedVersionGuard,
  versionedPackage,
  downloadSessionArtifact,
} from "./base.js";
import { nodeBootstrapLines, ensureNodeRuntime } from "./node-install.js";
import { deliverPrompt } from "./prompt-delivery.js";
import {
  installMCPServers,
  shellEnvAssignment,
  shellExpandedValue,
  sortedMapKeys,
  sortedUniqueMapValues,
} from "./mcp.js";
import {
  sessionCleanupOptions,
  withDownloadedSession,
} from "./session-lookup.js";
import { warnf } from "../logging/index.js";
import { contextWithConfiguredAgentSpanAttributes } from "../observability/index.js";
import {
  finalAssistantMessage,
  type Transcript,
  type Message,
} from "../contracts/transcript.js";
import type {
  Config,
  Runtime,
  ExecOptions,
  ExecResult,
  SessionResult,
  MCPConfig,
} from "./types.js";
import {
  RuntimeExecutionError,
  type MCPServerConfig,
} from "../runtime/types.js";
export const codexDefaultVersion = "0.80.0",
  codexProcessSandbox = "--sandbox workspace-write",
  codexBypassSandbox = "--dangerously-bypass-approvals-and-sandbox",
  codexCustomWireAPI = "chat",
  codexOpenAIOverrideProvider = "skilled-openai",
  codexDefaultRecordBytes = 16 << 20,
  codexDefaultOutputBytes = 256 << 20,
  codexRunArtifactPrefix = "skilled-codex.";
export const codexExecPathProbeCmd = `printf '%s' "$HOME/.local/bin:$HOME/.nvm/current/bin:$PATH"`;
export interface CodexProviderConfig {
  name?: string;
  label?: string;
  baseURL?: string;
  envKey?: string;
  wireAPI?: string;
}
export interface CodexUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
}
export interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  server?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
}
export interface CodexEvent {
  type?: string;
  thread_id?: string;
  item?: CodexItem | null;
  usage?: CodexUsage | null;
}
export interface CodexParseResult {
  transcript: Transcript;
  threadID: string;
  finalMsg: string;
  inputTokens: number;
  outputTokens: number;
  error?: Error;
}
interface CodexParseState extends CodexParseResult {
  currentTurn: number;
  commands: Map<string, number>;
  mcpCalls: Map<string, number>;
}
const emptyParsed = (): CodexParseResult => ({
  transcript: [],
  threadID: "",
  finalMsg: "",
  inputTokens: 0,
  outputTokens: 0,
});
const parseState = (): CodexParseState => ({
  ...emptyParsed(),
  currentTurn: 0,
  commands: new Map(),
  mcpCalls: new Map(),
});
export const codexUsageInputTotal = (u: CodexUsage): number =>
  (u.input_tokens ?? 0) +
  (u.cached_input_tokens ?? 0) +
  (u.cache_creation_input_tokens ?? 0);
export const codexTurns = (transcript: Transcript): number =>
  transcript.reduce((max, m) => Math.max(max, m.turn ?? 0), 0);
export function positiveCodexByteKwarg(
  kwargs: Record<string, string>,
  key: string,
  fallback: number,
): number {
  const raw = kwargs[key];
  if (raw === undefined) return fallback;
  const number = Number(raw.trim());
  if (
    !/^[+-]?\d+$/.test(raw.trim()) ||
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    warnf(
      "CodexAgent: engine kwarg %s=%s must be a positive integer; using %d",
      key,
      JSON.stringify(raw),
      fallback,
    );
    return fallback;
  }
  return number;
}
export function codexCustomProviderUnavailableReason(
  provider: string,
  baseURL: string,
): string {
  if (!provider || provider === "openai") return "";
  if (!baseURL) return "requires base_url";
  return isCodexProviderName(provider)
    ? ""
    : "must contain only letters, digits, underscores, or hyphens";
}
export const isCodexProviderName = (provider: string): boolean =>
  /^[A-Za-z0-9_-]+$/.test(provider);
export function codexProviderFlags(p: CodexProviderConfig): string {
  if (!p.name) return "";
  let flags = " -c " + shellQuote("model_provider=" + JSON.stringify(p.name));
  for (const [key, value] of [
    ["name", p.label],
    ["base_url", p.baseURL],
    ["env_key", p.envKey],
    ["wire_api", p.wireAPI],
  ])
    if (value)
      flags +=
        " -c " +
        shellQuote(
          "model_providers." + p.name + "." + key + "=" + JSON.stringify(value),
        );
  return flags;
}
export function buildCodexRunCmdWithLastMessage(
  instruction: string,
  model: string,
  provider: CodexProviderConfig,
  sandboxFlag: string,
  lastMessagePath: string,
): string {
  return (
    "codex exec --json --skip-git-repo-check" +
    (sandboxFlag ? " " + sandboxFlag : "") +
    codexProviderFlags(provider) +
    (model ? " -m " + shellQuote(model) : "") +
    (lastMessagePath
      ? " --output-last-message " + shellQuote(lastMessagePath)
      : "") +
    " " +
    shellQuote(instruction)
  );
}
export const buildCodexRunCmd = (
  instruction: string,
  model: string,
  p: CodexProviderConfig,
  sandbox: string,
): string =>
  buildCodexRunCmdWithLastMessage(instruction, model, p, sandbox, "");
export function buildCodexRunStdinCmdWithLastMessage(
  promptPath: string,
  model: string,
  p: CodexProviderConfig,
  sandbox: string,
  last: string,
): string {
  return (
    "cat " +
    shellQuote(promptPath) +
    " | codex exec --json --skip-git-repo-check" +
    (sandbox ? " " + sandbox : "") +
    codexProviderFlags(p) +
    (model ? " -m " + shellQuote(model) : "") +
    (last ? " --output-last-message " + shellQuote(last) : "")
  );
}
export function buildCodexResumeCmdWithLastMessage(
  sessionID: string,
  instruction: string,
  model: string,
  p: CodexProviderConfig,
  last: string,
): string {
  return (
    "codex exec resume --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox" +
    codexProviderFlags(p) +
    (model ? " -m " + shellQuote(model) : "") +
    (last ? " --output-last-message " + shellQuote(last) : "") +
    " " +
    shellQuote(sessionID) +
    " " +
    shellQuote(instruction)
  );
}
export function defaultCodexInstallCmdForVersion(
  configuredVersion: string,
): string {
  const version = configuredVersion.trim() || codexDefaultVersion;
  return [
    "set -e",
    installedVersionGuard("codex", version),
    ...nodeBootstrapLines("22"),
    "npm install -g --include=optional " +
      shellQuote(versionedPackage("@openai/codex", version)),
  ].join("\n");
}
export function buildCodexMCPInstallCmd(server: MCPServerConfig): string {
  let cmd =
    "codex mcp remove " +
    shellQuote(server.name) +
    " >/dev/null 2>&1 || true\ncodex mcp add " +
    shellQuote(server.name);
  switch (server.transport) {
    case "stdio":
      if (!server.command)
        throw new Error(
          `mcp server ${JSON.stringify(server.name)} stdio transport requires command`,
        );
      for (const key of sortedMapKeys(server.env ?? {}))
        cmd += " --env " + shellEnvAssignment(key);
      return (
        cmd +
        " -- " +
        [server.command, ...(server.args ?? [])].map(shellQuote).join(" ")
      );
    case "":
    case undefined:
    case "http":
      if (!server.endpoint)
        throw new Error(
          `mcp server ${JSON.stringify(server.name)} http transport requires endpoint`,
        );
      if (Object.keys(server.headers ?? {}).length)
        return buildCodexMCPRemoteInstallCmd(server);
      return cmd + " --url " + shellExpandedValue(server.endpoint);
    default:
      throw new Error(
        `mcp server ${JSON.stringify(server.name)} transport ${JSON.stringify(server.transport)} is not supported by codex`,
      );
  }
}
export function buildCodexMCPRemoteBridgeScript(
  server: MCPServerConfig,
): string {
  let script = 'exec npx mcp-remote "$1"';
  for (const key of sortedMapKeys(server.headers ?? {})) {
    const envName = server.headerEnv?.[key];
    if (envName && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName))
      throw new Error(
        `mcp server ${server.name} header ${key} environment variable ${envName} is invalid`,
      );
    script +=
      " --header " + shellExpandedValue(key + ":" + server.headers![key]);
  }
  return script + " 2>/dev/null";
}
export function buildCodexMCPRemoteInstallCmd(server: MCPServerConfig): string {
  const script = buildCodexMCPRemoteBridgeScript(server);
  let cmd =
    "codex mcp remove " +
    shellQuote(server.name) +
    " >/dev/null 2>&1 || true\ncodex mcp add " +
    shellQuote(server.name);
  for (const name of sortedUniqueMapValues(server.headerEnv ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
      throw new Error(
        `mcp server ${server.name} header environment variable ${name} is invalid`,
      );
    if (Object.hasOwn(server.env ?? {}, name))
      cmd += " --env " + shellEnvAssignment(name);
  }
  return (
    cmd +
    " -- 'sh' '-c' " +
    shellQuote(script) +
    " 'mcp-remote' " +
    shellExpandedValue(server.endpoint ?? "")
  );
}
export function codexToolResultStatus(output: string): string {
  const marker = "Process exited with code ",
    index = output.lastIndexOf(marker);
  if (index < 0) return "success";
  const code =
    output
      .slice(index + marker.length)
      .trim()
      .match(/^\d*/)?.[0] ?? "";
  return !code || code === "0" ? "success" : "error";
}
export const codexMCPToolResultStatus = (status: string): string =>
  ["", "completed", "success", "succeeded"].includes(
    status.trim().toLowerCase(),
  )
    ? "success"
    : "error";
export const codexMCPToolName = (server: string, tool: string): string =>
  server ? "mcp__" + server + "__" + tool : tool;
function stableJSON(value: unknown): string {
  if (value === null || value === undefined)
    return value === undefined ? "" : "null";
  if (Array.isArray(value)) return "[" + value.map(stableJSON).join(",") + "]";
  if (typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            stableJSON((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const codexMCPToolResultContent = (result: unknown): string =>
  result == null
    ? ""
    : stableJSON(result).replace(
        /[<>&\u2028\u2029]/g,
        (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
      );
function appendMCP(
  state: CodexParseState,
  item: CodexItem,
  turn: number,
): void {
  if (item.id) state.mcpCalls.set(item.id, turn);
  state.transcript.push({
    role: "tool_call",
    tool_call: {
      id: item.id ?? "",
      name: codexMCPToolName(item.server ?? "", item.tool ?? ""),
      ...(item.arguments ? { arguments: item.arguments } : {}),
    },
    turn,
  });
}
export function applyCodexEvent(
  state: CodexParseState,
  event: CodexEvent,
): void {
  const item = event.item,
    turn = Math.max(state.currentTurn, 1);
  switch (event.type) {
    case "thread.started":
      state.threadID = event.thread_id ?? "";
      break;
    case "turn.started":
      state.currentTurn++;
      break;
    case "turn.completed":
      if (event.usage) {
        state.inputTokens = Math.max(
          state.inputTokens,
          codexUsageInputTotal(event.usage),
        );
        state.outputTokens = Math.max(
          state.outputTokens,
          event.usage.output_tokens ?? 0,
        );
      }
      break;
    case "item.started":
      if (item?.type === "command_execution") {
        state.commands.set(item.id ?? "", turn);
        state.transcript.push({
          role: "tool_call",
          tool_call: {
            id: item.id ?? "",
            name: "command_execution",
            arguments: { command: item.command ?? "" },
          },
          turn,
        });
      } else if (item?.type === "mcp_tool_call") appendMCP(state, item, turn);
      break;
    case "item.completed":
      if (item?.type === "agent_message") {
        state.finalMsg = item.text ?? "";
        state.transcript.push({
          role: "assistant",
          content: item.text ?? "",
          turn,
        });
      } else if (item?.type === "command_execution") {
        const actualTurn = state.commands.get(item.id ?? "") ?? turn;
        if (!state.commands.has(item.id ?? ""))
          state.transcript.push({
            role: "tool_call",
            tool_call: {
              id: item.id ?? "",
              name: "command_execution",
              arguments: { command: item.command ?? "" },
            },
            turn: actualTurn,
          });
        state.transcript.push({
          role: "tool_result",
          tool_result: {
            call_id: item.id ?? "",
            status:
              item.exit_code != null && item.exit_code !== 0
                ? "error"
                : "success",
            content: item.aggregated_output ?? "",
          },
          turn: actualTurn,
        });
      } else if (item?.type === "mcp_tool_call") {
        const actualTurn = state.mcpCalls.get(item.id ?? "") ?? turn;
        if (!state.mcpCalls.has(item.id ?? "")) appendMCP(state, item, turn);
        state.transcript.push({
          role: "tool_result",
          tool_result: {
            call_id: item.id ?? "",
            status: codexMCPToolResultStatus(item.status ?? ""),
            content: codexMCPToolResultContent(item.result),
          },
          turn: actualTurn,
        });
      }
      break;
  }
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function validFields(
  value: Record<string, unknown>,
  strings: string[],
  integers: string[] = [],
): boolean {
  return (
    strings.every((k) => value[k] == null || typeof value[k] === "string") &&
    integers.every((k) => value[k] == null || Number.isInteger(value[k]))
  );
}
function validEvent(value: unknown): value is CodexEvent {
  if (!object(value) || !validFields(value, ["type", "thread_id"]))
    return false;
  if (value.item != null) {
    if (
      !object(value.item) ||
      !validFields(
        value.item,
        [
          "id",
          "type",
          "text",
          "command",
          "server",
          "tool",
          "aggregated_output",
          "status",
        ],
        ["exit_code"],
      )
    )
      return false;
    if (value.item.arguments != null && !object(value.item.arguments))
      return false;
  }
  if (
    value.usage != null &&
    (!object(value.usage) ||
      !validFields(
        value.usage,
        [],
        [
          "input_tokens",
          "cached_input_tokens",
          "output_tokens",
          "cache_creation_input_tokens",
        ],
      ))
  )
    return false;
  return true;
}
/** JSON decoder accepts adjacent objects on a single line, as Go json.Decoder does. */
export function applyCodexEventsFromLine(
  state: CodexParseState,
  line: string,
): void {
  let start = 0;
  while (start < line.length) {
    while (/\s/.test(line[start] ?? "") && start < line.length) start++;
    if (start >= line.length) return;
    if (line.slice(start, start + 4) === "null") {
      start += 4;
      continue;
    }
    let depth = 0,
      quoted = false,
      escaped = false,
      end = -1;
    for (let i = start; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
        continue;
      }
      if (c === '"') quoted = true;
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    try {
      if (end < 0) throw new Error("incomplete JSON");
      const event = JSON.parse(line.slice(start, end));
      if (!validEvent(event))
        throw new Error("event field has incompatible JSON type");
      applyCodexEvent(state, event);
    } catch (e) {
      warnf(
        "CodexAgent: failed to decode JSON event stream line; remaining events on the line are skipped: %s",
        String(e),
      );
      return;
    }
    start = end;
  }
}
function applyOutputRecord(state: CodexParseState, line: string): void {
  line = line.trim();
  if (line && line.startsWith("{")) applyCodexEventsFromLine(state, line);
}
export function parseCodexOutput(
  output: string,
  maxRecordBytes = codexDefaultRecordBytes,
): CodexParseResult {
  const state = parseState();
  if (maxRecordBytes <= 0)
    return {
      ...emptyParsed(),
      error: new Error("Codex stdout JSONL record limit must be positive"),
    };
  let n = 0;
  for (const line of output.split("\n")) {
    n++;
    if (Buffer.byteLength(line) > maxRecordBytes) {
      state.error = new Error(
        `Codex stdout JSONL record ${n} exceeds maximum size of ${maxRecordBytes} bytes`,
      );
      break;
    }
    applyOutputRecord(state, line);
  }
  return resultOnly(state);
}
function resultOnly(state: CodexParseState): CodexParseResult {
  const { currentTurn, commands, mcpCalls, ...result } = state;
  omitEmptyTranscriptFields(result.transcript);
  return result;
}
export async function readCodexJSONLRecords(
  reader: AsyncIterable<Uint8Array>,
  source: string,
  maxRecordBytes: number,
  apply: (line: string) => void,
): Promise<Error | undefined> {
  if (maxRecordBytes <= 0)
    return new Error(`${source} JSONL record limit must be positive`);
  let buffer = Buffer.alloc(0),
    record = 1;
  try {
    for await (const chunk of reader) {
      buffer = Buffer.concat([buffer, chunk]);
      let newline;
      while ((newline = buffer.indexOf(10)) >= 0) {
        if (newline > maxRecordBytes)
          return new Error(
            `${source} JSONL record ${record} exceeds maximum size of ${maxRecordBytes} bytes`,
          );
        apply(buffer.subarray(0, newline).toString("utf8"));
        buffer = buffer.subarray(newline + 1);
        record++;
      }
      if (buffer.length > maxRecordBytes)
        return new Error(
          `${source} JSONL record ${record} exceeds maximum size of ${maxRecordBytes} bytes`,
        );
    }
    if (buffer.length) apply(buffer.toString("utf8"));
  } catch (e) {
    return new Error(`read ${source} JSONL record ${record}: ${String(e)}`, {
      cause: e,
    });
  }
  return undefined;
}
export async function parseCodexOutputFile(
  file: string,
  maxRecordBytes = codexDefaultRecordBytes,
): Promise<CodexParseResult> {
  const state = parseState();
  state.error = await readCodexJSONLRecords(
    createReadStream(file),
    "Codex stdout",
    maxRecordBytes,
    (line) => applyOutputRecord(state, line),
  );
  return resultOnly(state);
}
export interface CodexSessionPayload {
  type?: string;
  role?: string;
  content?: { type?: string; text?: string }[];
  message?: string;
  phase?: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  output?: string;
  info?: { total_token_usage?: CodexUsage };
}
export const codexSessionContentText = (
  content: CodexSessionPayload["content"],
): string =>
  (content ?? [])
    .filter(
      (p) =>
        p != null &&
        ["input_text", "output_text"].includes(p.type ?? "") &&
        p.text,
    )
    .map((p) => p.text)
    .join("\n\n");
export function parseCodexSessionResponseItem(
  payload: CodexSessionPayload,
  currentTurn: number,
): { messages: Transcript; finalMsg: string; turn: number } {
  switch (payload.type) {
    case "message": {
      const content = codexSessionContentText(payload.content);
      if (!content) return { messages: [], finalMsg: "", turn: currentTurn };
      const role = payload.role === "user" ? "user" : "assistant";
      if (role === "user") currentTurn++;
      if (currentTurn === 0) currentTurn = 1;
      return {
        messages: [{ role, content, turn: currentTurn }],
        finalMsg: role === "assistant" ? content : "",
        turn: currentTurn,
      };
    }
    case "function_call":
      return {
        messages: [
          {
            role: "tool_call",
            tool_call: {
              id: payload.call_id ?? "",
              name: payload.name ?? "",
              arguments: { arguments: payload.arguments ?? "" },
            },
            turn: currentTurn,
          },
        ],
        finalMsg: "",
        turn: currentTurn,
      };
    case "function_call_output":
      return {
        messages: [
          {
            role: "tool_result",
            tool_result: {
              call_id: payload.call_id ?? "",
              status: codexToolResultStatus(payload.output ?? ""),
              content: payload.output ?? "",
            },
            turn: currentTurn,
          },
        ],
        finalMsg: "",
        turn: currentTurn,
      };
    default:
      return { messages: [], finalMsg: "", turn: currentTurn };
  }
}
export function applyCodexSessionEventMsg(
  payload: CodexSessionPayload,
  turn: number,
): {
  messages: Transcript;
  finalMsg: string;
  inputTokens: number;
  outputTokens: number;
} {
  const result = {
    messages: [] as Transcript,
    finalMsg: "",
    inputTokens: 0,
    outputTokens: 0,
  };
  if (payload.type === "agent_message") {
    result.messages = [
      { role: "assistant", content: payload.message ?? "", turn },
    ];
    result.finalMsg = payload.message ?? "";
  } else if (
    payload.type === "token_count" &&
    payload.info?.total_token_usage
  ) {
    result.inputTokens = codexUsageInputTotal(payload.info.total_token_usage);
    result.outputTokens = payload.info.total_token_usage.output_tokens ?? 0;
  }
  return result;
}
export async function parseCodexSessionFileWithLimit(
  file: string,
  maxRecordBytes: number,
): Promise<CodexParseResult> {
  const parsed = emptyParsed();
  let turn = 0;
  parsed.error = await readCodexJSONLRecords(
    createReadStream(file),
    "Codex session",
    maxRecordBytes,
    (line) => {
      line = line.trim();
      if (!line || line === "[]" || line === "{}") return;
      let event: { type?: string; payload?: CodexSessionPayload };
      try {
        event = JSON.parse(line);
        if (
          !object(event) ||
          !validFields(event, ["type", "timestamp"]) ||
          !object(event.payload) ||
          !validFields(event.payload, [
            "type",
            "role",
            "message",
            "phase",
            "name",
            "arguments",
            "call_id",
            "output",
          ])
        )
          return;
        if (
          event.payload.content != null &&
          (!Array.isArray(event.payload.content) ||
            event.payload.content.some(
              (c) =>
                c != null && (!object(c) || !validFields(c, ["type", "text"])),
            ))
        )
          return;
        if (event.payload.info != null) {
          if (!object(event.payload.info)) return;
          const usage = event.payload.info.total_token_usage;
          if (
            usage != null &&
            (!object(usage) ||
              !validFields(
                usage,
                [],
                [
                  "input_tokens",
                  "cached_input_tokens",
                  "output_tokens",
                  "cache_creation_input_tokens",
                ],
              ))
          )
            return;
        }
      } catch {
        return;
      }
      if (event.type === "response_item") {
        const r = parseCodexSessionResponseItem(event.payload, turn);
        parsed.transcript.push(...r.messages);
        if (r.finalMsg) parsed.finalMsg = r.finalMsg;
        turn = r.turn;
      } else if (event.type === "event_msg") {
        const r = applyCodexSessionEventMsg(event.payload, turn);
        parsed.transcript.push(...r.messages);
        if (r.finalMsg) parsed.finalMsg = r.finalMsg;
        parsed.inputTokens = Math.max(parsed.inputTokens, r.inputTokens);
        parsed.outputTokens = Math.max(parsed.outputTokens, r.outputTokens);
      }
    },
  );
  parsed.finalMsg ||= finalAssistantMessage(parsed.transcript);
  omitEmptyTranscriptFields(parsed.transcript);
  return parsed;
}
export const parseCodexSessionFile = (
  file: string,
): Promise<CodexParseResult> =>
  parseCodexSessionFileWithLimit(file, codexDefaultRecordBytes);
export function targetPathJoin(
  goos: string,
  dir: string,
  name: string,
): string {
  return goos === "windows"
    ? path.win32.join(dir, name)
    : path.posix.join(dir, name);
}
export function validCodexRunArtifactDir(goos: string, dir: string): boolean {
  const p = goos === "windows" ? path.win32 : path.posix;
  dir = p.normalize(dir);
  return (
    p.isAbsolute(dir) && p.basename(dir).startsWith(codexRunArtifactPrefix)
  );
}
export function codexArtifactTransferOptions(
  opts: ExecOptions,
  maxOutputBytes: number,
): ExecOptions {
  const megabytes = Math.min(Math.floor(maxOutputBytes / (1 << 20)) + 1, 1770);
  return {
    ...opts,
    signal: AbortSignal.timeout(Math.max(120_000, 30_000 + megabytes * 1000)),
  };
}
export async function prepareCodexRunArtifacts(
  rt: Runtime,
  opts: ExecOptions = {},
): Promise<{ dir: string; lastMessagePath: string; stdoutPath: string }> {
  const name = codexRunArtifactPrefix + randomBytes(8).toString("hex"),
    windows = rt.shell().goos === "windows";
  const dir = windows
    ? path.win32.join(path.win32.dirname(rt.workspace()), name)
    : path.posix.join("/tmp", name);
  const result = await rt.exec("mkdir -p " + shellQuote(dir), opts);
  if (result.exitCode !== 0)
    throw new Error(
      `create Codex run artifact directory: exit ${result.exitCode}: ${result.stderr.trim()}`,
    );
  return {
    dir,
    lastMessagePath: targetPathJoin(rt.shell().goos, dir, "last-message.txt"),
    stdoutPath: targetPathJoin(rt.shell().goos, dir, "stdout.json"),
  };
}
export async function cleanupCodexRunArtifacts(
  rt: Runtime,
  dir: string,
  opts: ExecOptions = {},
): Promise<void> {
  if (!validCodexRunArtifactDir(rt.shell().goos, dir)) return;
  try {
    const result = await rt.exec(
      "rm -rf -- " + shellQuote(dir),
      sessionCleanupOptions(opts),
    );
    if (result.exitCode !== 0)
      warnf(
        "CodexAgent: failed to remove run artifact directory %s: exit_code=%d",
        dir,
        result.exitCode,
      );
  } catch (e) {
    warnf(
      "CodexAgent: failed to remove run artifact directory %s: %s",
      dir,
      String(e),
    );
  }
}
export async function checkCodexRemoteJSONLSize(
  rt: Runtime,
  remotePath: string,
  source: string,
  maxOutputBytes: number,
  opts: ExecOptions = {},
): Promise<void> {
  if (maxOutputBytes <= 0)
    throw new Error(`${source} JSONL output limit must be positive`);
  const result = await rt.exec("wc -c <" + shellQuote(remotePath), opts);
  if (result.exitCode !== 0)
    throw new Error(
      `measure ${source} JSONL artifact ${remotePath}: exit ${result.exitCode}: ${result.stderr.trim()}`,
    );
  const value = result.stdout.trim(),
    size = Number(value);
  if (!/^[+-]?\d+$/.test(value) || !Number.isSafeInteger(size) || size < 0)
    throw new Error(
      `measure ${source} JSONL artifact ${remotePath}: invalid byte count ${JSON.stringify(value)}`,
    );
  if (size > maxOutputBytes)
    throw new Error(
      `${source} JSONL output is ${size} bytes, exceeding maximum size of ${maxOutputBytes} bytes`,
    );
}
export async function downloadCodexJSONL(
  rt: Runtime,
  artifactDir: string,
  remotePath: string,
  source: string,
  maxOutputBytes: number,
  opts: ExecOptions = {},
): Promise<{ artifactPath: string; cleanup: () => Promise<void> }> {
  await checkCodexRemoteJSONLSize(
    rt,
    remotePath,
    source,
    maxOutputBytes,
    sessionCleanupOptions(opts),
  );
  const transferred = await downloadSessionArtifact(
    rt,
    artifactDir,
    remotePath,
    codexArtifactTransferOptions(opts, maxOutputBytes).signal,
  );
  if (!transferred.ok)
    throw new Error(`download ${source} JSONL artifact ${remotePath}`);
  return {
    artifactPath: transferred.artifactPath,
    cleanup: transferred.cleanup,
  };
}
export async function persistCodexStdoutArtifact(
  rt: Runtime,
  artifactDir: string,
  artifactPath: string,
  maxOutputBytes: number,
  opts: ExecOptions = {},
): Promise<string> {
  if (artifactDir) return artifactPath;
  const registered = path.join(rt.workspace(), ".skilled", "stdout.json");
  await rt.uploadFile(
    artifactPath,
    registered,
    codexArtifactTransferOptions(opts, maxOutputBytes).signal,
  );
  return registered;
}
export async function findCodexSessionPath(
  rt: Runtime,
  threadID: string,
  opts: ExecOptions = {},
): Promise<string> {
  threadID = threadID.trim();
  if (!threadID) return "";
  const script =
    'home=$(printenv HOME); [ -n "$home" ] || exit 0\nroot="$home/.codex/sessions"; [ -d "$root" ] || exit 0\nfind "$root" -type f -name "*$SKILLED_CODEX_THREAD_ID*.jsonl" 2>/dev/null | head -1';
  try {
    const r = await rt.exec(script, {
      ...opts,
      env: { SKILLED_CODEX_THREAD_ID: threadID },
    });
    const value = r.stdout.trim();
    return r.exitCode === 0 && value.endsWith(".jsonl") ? value : "";
  } catch {
    return "";
  }
}
export async function resolveCodexLastMessage(
  rt: Runtime,
  artifactDir: string,
  lastMessagePath: string,
  finalMsg: string,
  transcript: Transcript,
  generatedFiles: string[],
  opts: ExecOptions = {},
): Promise<{
  finalMsg: string;
  transcript: Transcript;
  generatedFiles: string[];
  cleanup: () => Promise<void>;
}> {
  const result = {
    finalMsg,
    transcript,
    generatedFiles,
    cleanup: async () => {},
  };
  if (!lastMessagePath) return result;
  const downloaded = await downloadSessionArtifact(
    rt,
    artifactDir,
    lastMessagePath,
    opts.signal,
  );
  if (!downloaded.ok) return result;
  result.cleanup = downloaded.cleanup;
  let registered = downloaded.artifactPath;
  if (!artifactDir) {
    registered = path.join(
      rt.workspace(),
      ".skilled",
      "codex-last-message.txt",
    );
    try {
      await rt.uploadFile(downloaded.artifactPath, registered, opts.signal);
    } catch (e) {
      warnf(
        "CodexAgent: failed to persist last-message artifact: %s",
        String(e),
      );
      registered = "";
    }
  }
  if (registered) result.generatedFiles = [...generatedFiles, registered];
  try {
    const last = (await readFile(downloaded.artifactPath, "utf8")).trim();
    if (last && last !== finalMsg) {
      result.finalMsg = last;
      result.transcript = [
        ...transcript,
        {
          role: "assistant",
          content: last,
          turn: Math.max(codexTurns(transcript), 1),
        },
      ];
    }
  } catch {}
  return result;
}
export async function finalizeCodexTranscript(
  rt: Runtime,
  artifactDir: string,
  lastMessagePath: string,
  instruction: string,
  transcript: Transcript,
  finalMsg: string,
  files: string[],
  opts: ExecOptions = {},
): Promise<Awaited<ReturnType<typeof resolveCodexLastMessage>>> {
  if (!transcript.length && instruction)
    transcript = [{ role: "user", content: instruction, turn: 1 }];
  finalMsg ||= finalAssistantMessage(transcript);
  return resolveCodexLastMessage(
    rt,
    artifactDir,
    lastMessagePath,
    finalMsg,
    transcript,
    files,
    sessionCleanupOptions(opts),
  );
}
export class CodexAgent extends CLIAgent {
  constructor(cfg: Config) {
    super({
      ...cfg,
      name: cfg.name || "codex",
      checkCmd: cfg.checkCmd || "command -v codex",
      versionCmd: cfg.versionCmd || "codex --version",
      skillPath: cfg.skillPath || ".codex/skills",
    });
  }
  jsonlLimits(): { recordBytes: number; outputBytes: number } {
    return {
      recordBytes: positiveCodexByteKwarg(
        this.cfg.kwargs,
        "max_jsonl_record_bytes",
        codexDefaultRecordBytes,
      ),
      outputBytes: positiveCodexByteKwarg(
        this.cfg.kwargs,
        "max_jsonl_output_bytes",
        codexDefaultOutputBytes,
      ),
    };
  }
  appliedModelName(): string {
    return codexCustomProviderUnavailableReason(
      this.cfg.modelProvider,
      this.cfg.baseURL,
    )
      ? ""
      : this.cfg.modelName.trim();
  }
  runProviderConfig(): CodexProviderConfig {
    const provider = this.cfg.modelProvider,
      url = this.cfg.baseURL;
    if (!provider || provider === "openai")
      return url
        ? {
            name: codexOpenAIOverrideProvider,
            label: codexOpenAIOverrideProvider,
            baseURL: url,
            envKey: "OPENAI_API_KEY",
            wireAPI: "chat",
          }
        : {};
    if (codexCustomProviderUnavailableReason(provider, url)) return {};
    return {
      name: provider,
      label: provider,
      baseURL: url,
      envKey: "OPENAI_API_KEY",
      wireAPI: "chat",
    };
  }
  async install(rt: Runtime, signal?: AbortSignal): Promise<void> {
    await this.probeAndMergePATH(rt, codexExecPathProbeCmd, signal);
    const opts = this.mergeExecOptionsEnv({ cwd: "/", signal }, {}, {}),
      result = await rt.exec(
        this.cfg.installCmd ||
          defaultCodexInstallCmdForVersion(this.cfg.version),
        opts,
      );
    if (result.exitCode !== 0)
      throw new Error(
        "install failed: agent installation failed: " + result.stderr,
      );
  }
  async installMCP(
    rt: Runtime,
    config: MCPConfig,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!config.servers.length) return;
    await ensureNodeRuntime(rt, "codex", { signal });
    await installMCPServers(rt, config, buildCodexMCPInstallCmd, signal);
  }
  async checkCredentials(): Promise<void> {
    this.logCredentialStatus(
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
      "OPENAI_API_KEY not set, codex will rely on existing login state if available",
    );
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
    sessionID: string,
  ): Promise<SessionResult> {
    if (!sessionID) return this.run(rt, opts, [message]);
    return this.execute(rt, opts, message.content ?? "", sessionID);
  }
  private async execute(
    rt: Runtime,
    opts: ExecOptions,
    instruction: string,
    sessionID: string,
  ): Promise<SessionResult> {
    requireBashTargetShell(rt);
    const start = performance.now();
    opts = this.mergeExecOptionsEnv(
      opts,
      this.credentialEnvVars("OPENAI_API_KEY", "OPENAI_BASE_URL"),
      this.buildAgentObservabilityAttrs(
        sessionID ? { "codex.session_id": sessionID } : {},
      ),
    );
    opts.context = contextWithConfiguredAgentSpanAttributes(
      opts.context ?? ROOT_CONTEXT,
      opts.env ?? {},
    );
    try {
      await ensureNodeRuntime(rt, "codex", opts);
    } catch (e) {
      const result: SessionResult = {
        engine: this.name(),
        ...(sessionID ? { session_id: sessionID } : {}),
        exit_code: 1,
        duration_ms: Math.floor(performance.now() - start),
        turns: 0,
        artifacts: {},
      };
      this.annotateSessionResult(result);
      throw new AgentExecutionError(String(e), result, { cause: e });
    }
    const paths = await prepareCodexRunArtifacts(rt, {
      context: opts.context,
      signal: opts.signal,
    });
    let command: string, delivery: SessionResult["prompt_delivery"];
    if (sessionID)
      command = buildCodexResumeCmdWithLastMessage(
        sessionID,
        instruction,
        this.appliedModelName(),
        this.runProviderConfig(),
        paths.lastMessagePath,
      );
    else {
      const bypass = ["1", "t", "T", "TRUE", "true", "True"].includes(
        (this.cfg.kwargs.bypass_sandbox ?? "").trim(),
      );
      const sandbox =
        rt.requiresProcessSandbox() && !bypass
          ? codexProcessSandbox
          : codexBypassSandbox;
      try {
        const d = await deliverPrompt(rt, opts, instruction, {
          inline: (p) =>
            buildCodexRunCmdWithLastMessage(
              p,
              this.appliedModelName(),
              this.runProviderConfig(),
              sandbox,
              paths.lastMessagePath,
            ),
          stdinFile: (p) =>
            buildCodexRunStdinCmdWithLastMessage(
              p,
              this.appliedModelName(),
              this.runProviderConfig(),
              sandbox,
              paths.lastMessagePath,
            ),
        });
        command = d.command;
        delivery = d.metadata;
      } catch (e) {
        await cleanupCodexRunArtifacts(rt, paths.dir, opts);
        const result: SessionResult = {
          engine: this.name(),
          exit_code: 1,
          duration_ms: Math.floor(performance.now() - start),
          turns: 0,
          artifacts: {},
        };
        this.annotateSessionResult(result);
        throw new AgentExecutionError(String(e), result, { cause: e });
      }
    }
    let execution: ExecResult, error: unknown;
    try {
      execution = await rt.exec(
        command + " >" + shellQuote(paths.stdoutPath),
        opts,
      );
    } catch (e) {
      error = e;
      execution =
        e instanceof RuntimeExecutionError
          ? e.result
          : { stdout: "", stderr: "", exitCode: 1 };
    }
    const built = await this.buildSessionResult(
      rt,
      opts,
      instruction,
      start,
      execution,
      paths.dir,
      paths.lastMessagePath,
      paths.stdoutPath,
    );
    const result = built.result;
    if (sessionID) result.session_id = sessionID;
    if (delivery) result.prompt_delivery = delivery;
    this.annotateSessionResult(result);
    const mode = sessionID ? "resume" : "run";
    if (error || execution.exitCode !== 0 || built.error) {
      const message = error
        ? `codex ${mode} failed: ${String(error)}`
        : execution.exitCode !== 0
          ? `codex ${mode} failed (exit ${execution.exitCode}): ${execution.stderr}`
          : `codex output parsing failed: ${built.error?.message}`;
      throw new AgentExecutionError(message, result, {
        cause:
          built.error && error
            ? new AggregateError([error, built.error], message)
            : (built.error ?? error),
      });
    }
    return result;
  }
  async buildSessionResult(
    rt: Runtime,
    opts: ExecOptions,
    instruction: string,
    start: number,
    execution: ExecResult,
    runArtifactDir: string,
    lastMessagePath: string,
    stdoutPath: string,
  ): Promise<{ result: SessionResult; error?: Error }> {
    const limits = this.jsonlLimits(),
      errors: unknown[] = [],
      cleanups: (() => Promise<void>)[] = [];
    let files: string[] = [],
      parsed = emptyParsed();
    try {
      try {
        const downloaded = await downloadCodexJSONL(
          rt,
          opts.artifactDir ?? "",
          stdoutPath,
          "Codex stdout",
          limits.outputBytes,
          opts,
        );
        cleanups.push(downloaded.cleanup);
        parsed = await parseCodexOutputFile(
          downloaded.artifactPath,
          limits.recordBytes,
        );
        if (parsed.error) errors.push(parsed.error);
        try {
          const persisted = await persistCodexStdoutArtifact(
            rt,
            opts.artifactDir ?? "",
            downloaded.artifactPath,
            limits.outputBytes,
            opts,
          );
          if (persisted) files.push(persisted);
        } catch (e) {
          errors.push(e);
        }
      } catch (e) {
        errors.push(e);
      }
      let transcript = parsed.transcript,
        finalMsg = parsed.finalMsg,
        inputTokens = parsed.inputTokens,
        outputTokens = parsed.outputTokens;
      const sessionPath = await findCodexSessionPath(
        rt,
        parsed.threadID,
        sessionCleanupOptions(opts),
      );
      let sessionError = false;
      if (sessionPath)
        try {
          await checkCodexRemoteJSONLSize(
            rt,
            sessionPath,
            "Codex session",
            limits.outputBytes,
            sessionCleanupOptions(opts),
          );
        } catch (e) {
          errors.push(e);
          sessionError = true;
        }
      if (!sessionError) {
        const download = await withDownloadedSession(
          rt,
          opts.artifactDir ?? "",
          sessionPath,
          files,
          async (local) => {
            const session = await parseCodexSessionFileWithLimit(
              local,
              limits.recordBytes,
            );
            if (session.error) errors.push(session.error);
            if (
              session.transcript.length > parsed.transcript.length &&
              (session.finalMsg || execution.exitCode !== 0 || !finalMsg)
            ) {
              transcript = session.transcript;
              finalMsg = session.finalMsg;
              inputTokens = session.inputTokens;
              outputTokens = session.outputTokens;
            }
          },
          codexArtifactTransferOptions(opts, limits.outputBytes),
        );
        files = download.files;
        cleanups.push(download.cleanup);
      }
      const final = await finalizeCodexTranscript(
        rt,
        opts.artifactDir ?? "",
        lastMessagePath,
        instruction,
        transcript,
        finalMsg,
        files,
        opts,
      );
      cleanups.push(final.cleanup);
      const result: SessionResult = {
        engine: this.name(),
        session_id: parsed.threadID,
        exit_code: execution.exitCode,
        duration_ms: Math.floor(performance.now() - start),
        turns: codexTurns(final.transcript),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        final_message: final.finalMsg,
        stderr: execution.stderr,
        transcript: final.transcript,
        artifacts: { generated_files: final.generatedFiles },
      };
      return {
        result,
        ...(errors.length
          ? { error: new AggregateError(errors, errors.map(String).join("\n")) }
          : {}),
      };
    } finally {
      for (const cleanup of cleanups.reverse()) await cleanup();
      await cleanupCodexRunArtifacts(rt, runArtifactDir, opts);
    }
  }
}
import { AgentExecutionError } from "./errors.js";
