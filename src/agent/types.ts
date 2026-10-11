// Modified for the skilled TypeScript distribution.
import type { CustomEngineConfig } from "../contracts/schema.js";
import type { Message, Transcript } from "../contracts/transcript.js";
import type {
  Runtime,
  ExecOptions,
  MCPConfig,
  SkillConfig,
} from "../runtime/types.js";
export type {
  Runtime,
  ExecOptions,
  ExecResult,
  MCPConfig,
  SkillConfig,
} from "../runtime/types.js";
export interface PromptDeliveryMetadata {
  mode: string;
  prompt_bytes: number;
  inline_max_bytes: number;
  prompt_path?: string;
  runtime_path?: string;
}
export interface ArtifactFile {
  name: string;
  path?: string;
  url?: string;
  content?: string;
  content_base64?: string;
  content_type?: string;
}
export interface SessionArtifacts {
  workspace_diff?: string;
  generated_files?: string[];
  generated_file_sources?: string[];
  files?: ArtifactFile[];
  logs?: string;
}
export interface SessionResult {
  engine?: string;
  applied_protocol?: string;
  requested_provider?: string;
  applied_provider?: string;
  requested_model?: string;
  applied_model?: string;
  model?: string;
  version?: string;
  warnings?: string[];
  session_id?: string;
  exit_code: number;
  duration_ms: number;
  turns: number;
  input_tokens?: number;
  output_tokens?: number;
  final_message?: string;
  stderr?: string;
  transcript?: Transcript;
  artifacts?: SessionArtifacts | null;
  prompt_delivery?: PromptDeliveryMetadata | null;
}
export interface AgentConfig {
  name: string;
  version?: string;
  installCmd?: string;
  runCmd?: string;
  versionCmd?: string;
  checkCmd?: string;
  installMCPCmd?: string;
  installSkillCmd?: string;
  envVars?: Record<string, string>;
  skillPath?: string;
  modelName?: string;
  requestedModelName?: string;
  requestedProvider?: string;
  modelProvider?: string;
  protocol?: string;
  warnings?: string[];
  apiKey?: string;
  baseURL?: string;
  kwargs?: Record<string, string>;
  custom?: CustomEngineConfig | null;
}
export type Config = AgentConfig;
export type NormalizedAgentConfig = Required<AgentConfig>;
export interface RuntimeObservation {
  version: string;
}
export interface Agent {
  name(): string;
  install(rt: Runtime, signal?: AbortSignal): Promise<void>;
  installMCP(
    rt: Runtime,
    config: MCPConfig,
    signal?: AbortSignal,
  ): Promise<void>;
  installSkill(
    rt: Runtime,
    config: SkillConfig,
    signal?: AbortSignal,
  ): Promise<void>;
  run(
    rt: Runtime,
    options: ExecOptions,
    messages: Message[],
  ): Promise<SessionResult>;
  check(rt: Runtime, signal?: AbortSignal): Promise<void>;
  checkCredentials(signal?: AbortSignal): Promise<void>;
}
export interface SessionResumer {
  runTurn(
    rt: Runtime,
    options: ExecOptions,
    message: Message,
    sessionID: string,
  ): Promise<SessionResult>;
}
export interface StrictSessionResumer {
  requiresSessionIDForNextTurn(): boolean;
}
export interface IncrementalSessionResumer {
  returnsIncrementalSessionResults(): boolean;
}
export interface RuntimeInspector {
  inspectRuntime(
    rt: Runtime,
    signal?: AbortSignal,
  ): Promise<RuntimeObservation>;
}
export const exitCodeSignalKilled = -1;

// Match source JSON omission rules without changing arbitrary tool-result payloads.
export function normalizeSessionResult(result: SessionResult): SessionResult {
  const prune = (obj: object, required: string[] = []) => {
    for (const [key, value] of Object.entries(obj))
      if (
        !required.includes(key) &&
        (value == null ||
          value === "" ||
          value === 0 ||
          (Array.isArray(value) && value.length === 0))
      )
        delete (obj as Record<string, unknown>)[key];
  };
  prune(result, ["exit_code", "duration_ms", "turns"]);
  if (result.artifacts) {
    if (result.artifacts.generated_file_sources)
      Object.defineProperty(result.artifacts, "generated_file_sources", {
        value: result.artifacts.generated_file_sources,
        enumerable: false,
        writable: true,
        configurable: true,
      });
    prune(result.artifacts);
    for (const file of result.artifacts.files ?? []) prune(file, ["name"]);
  }
  for (const message of result.transcript ?? []) {
    message.role ??= "";
    prune(message, ["role"]);
    if (message.tool_call) {
      message.tool_call.name ??= "";
      prune(message.tool_call, ["name"]);
      if (
        message.tool_call.arguments &&
        Object.keys(message.tool_call.arguments).length === 0
      )
        delete message.tool_call.arguments;
    }
    if (message.tool_result) {
      const payload = message.tool_result.content;
      prune(message.tool_result);
      if (payload !== undefined && payload !== null)
        message.tool_result.content = payload;
    }
  }
  return result;
}
