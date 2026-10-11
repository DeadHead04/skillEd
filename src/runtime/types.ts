// Modified for the skilled TypeScript distribution.
import type { Context } from "@opentelemetry/api";
import type { Shell } from "../platform/index.js";
export interface RuntimeConfig {
  type: "none" | "docker" | "opensandbox";
  image?: string;
  workspaceMount?: string;
  workspaceDir?: string;
  env?: Record<string, string>;
  setupSteps?: { run: string }[];
  sandboxTemplate?: string;
  useServerProxy?: boolean;
  readyTimeoutMs?: number;
  sandboxTimeoutMs?: number;
  entrypoint?: string[];
  metadata?: Record<string, string>;
  kwargs?: Record<string, string>;
  networkPolicy?: "deny_all" | "allow_declared" | "";
  allowedEgress?: string[];
  skillPath?: string;
  delete?: boolean;
}
export interface AgentMetadata {
  caseID: string;
  variant: string;
  maxTurns: number;
}
export interface ExecOptions {
  context?: Context;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  artifactDir?: string;
  agentMetadata?: AgentMetadata;
  signal?: AbortSignal;
}
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
export class RuntimeExecutionError extends Error {
  constructor(
    message: string,
    public readonly result: ExecResult,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RuntimeExecutionError";
  }
}
export interface Runtime {
  create(signal?: AbortSignal): Promise<void>;
  close(): Promise<void>;
  start(signal?: AbortSignal): Promise<void>;
  stop(signal?: AbortSignal): Promise<void>;
  uploadFile(
    source: string,
    target: string,
    signal?: AbortSignal,
  ): Promise<void>;
  uploadDir(
    source: string,
    target: string,
    signal?: AbortSignal,
  ): Promise<void>;
  downloadFile(
    source: string,
    target: string,
    signal?: AbortSignal,
  ): Promise<void>;
  downloadDir(
    source: string,
    target: string,
    signal?: AbortSignal,
  ): Promise<void>;
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  mergeEnv(env: Record<string, string>): void;
  workspace(): string;
  requiresProcessSandbox(): boolean;
  shell(): Shell;
}
export interface JudgeSnapshot {
  fork(
    signal?: AbortSignal,
  ): Promise<{ runtime: Runtime; cleanup: () => Promise<void> }>;
  close(): Promise<void>;
}
export interface JudgeSnapshotProvider {
  captureJudgeSnapshot(signal?: AbortSignal): Promise<JudgeSnapshot>;
}
export interface MCPServerConfig {
  name: string;
  mode?: string;
  transport?: string;
  command?: string;
  args?: string[];
  endpoint?: string;
  configRef?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  headerEnv?: Record<string, string>;
}
export interface MCPConfig {
  servers: MCPServerConfig[];
}
export interface SkillConfig {
  source: string;
  target: string;
  include?: string[];
  exclude?: string[];
}
