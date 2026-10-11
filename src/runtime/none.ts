// Modified for the skilled TypeScript distribution.
import { instrumentExec } from "./instrumentation.js";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { hostShell, type Shell } from "../platform/index.js";
import type {
  Runtime,
  RuntimeConfig,
  ExecOptions,
  ExecResult,
  JudgeSnapshot,
  JudgeSnapshotProvider,
} from "./types.js";
import { copyFile, copyTree, copyJudgeTree, removeOwnedTree } from "./files.js";
import { runProcess, mergedEnv } from "./process.js";
export class NoneRuntime implements Runtime, JudgeSnapshotProvider {
  private directory = "";
  private ownsDirectory = false;
  private config: RuntimeConfig;
  constructor(config: RuntimeConfig) {
    this.config = { ...config, env: { ...config.env } };
  }
  async create(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.directory) return;
    if (this.config.workspaceDir) {
      const directory = path.resolve(this.config.workspaceDir);
      if (!(await fs.stat(directory)).isDirectory())
        throw new Error(`existing workspace ${directory} is not a directory`);
      this.directory = directory;
    } else {
      this.directory = await fs.mkdtemp(path.join(os.tmpdir(), "skilled-"));
      this.ownsDirectory = true;
    }
  }
  async close(): Promise<void> {
    if (this.directory && this.ownsDirectory && this.config.delete)
      await removeOwnedTree(this.directory);
  }
  async start(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
  }
  async stop(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
  }
  workspace(): string {
    return this.directory;
  }
  requiresProcessSandbox(): boolean {
    return true;
  }
  shell(): Shell {
    return hostShell().target;
  }
  mergeEnv(env: Record<string, string>): void {
    Object.assign(this.config.env!, env);
  }
  private resolve(name: string): string {
    if (!this.directory) throw new Error("runtime has not been created");
    return path.isAbsolute(name)
      ? path.normalize(name)
      : path.join(this.directory, name);
  }
  async uploadFile(
    source: string,
    target: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await copyFile(source, this.resolve(target), signal);
  }
  async uploadDir(
    source: string,
    target: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await copyTree(source, this.resolve(target), signal);
  }
  async downloadFile(
    source: string,
    target: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await copyFile(this.resolve(source), target, signal, false);
  }
  async downloadDir(
    source: string,
    target: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await copyTree(this.resolve(source), target, signal);
  }
  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    const shell = hostShell();
    return instrumentExec(
      "none",
      command,
      { ...options, cwd: options.cwd || this.directory },
      () =>
        runProcess(shell.executable, shell.args(command), {
          cwd: options.cwd || this.directory || undefined,
          env: { ...mergedEnv(this.config.env, options.env), ...shell.env },
          signal: options.signal,
          timeoutMs: options.timeoutMs,
          windowsVerbatimArguments: shell.target.family === "cmd",
        }),
    );
  }
  async captureJudgeSnapshot(signal?: AbortSignal): Promise<JudgeSnapshot> {
    if (!this.directory) throw new Error("runtime has not been created");
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "skilled-judge-snapshot-"),
    );
    try {
      await copyJudgeTree(this.directory, directory, signal);
    } catch (error) {
      await removeOwnedTree(directory);
      throw error;
    }
    return new NoneJudgeSnapshot(directory, {
      ...this.config,
      env: { ...this.config.env },
    });
  }
}
class NoneJudgeSnapshot implements JudgeSnapshot {
  private closed = false;
  constructor(
    private readonly directory: string,
    private readonly config: RuntimeConfig,
  ) {}
  async fork(
    signal?: AbortSignal,
  ): Promise<{ runtime: Runtime; cleanup: () => Promise<void> }> {
    if (this.closed) throw new Error("snapshot is closed");
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "skilled-judge-"),
    );
    try {
      await copyJudgeTree(this.directory, directory, signal);
      const runtime = new NoneRuntime({
        ...this.config,
        workspaceDir: directory,
        env: { ...this.config.env },
      });
      await runtime.create(signal);
      return { runtime, cleanup: () => removeOwnedTree(directory) };
    } catch (error) {
      await removeOwnedTree(directory);
      throw error;
    }
  }
  async close(): Promise<void> {
    await removeOwnedTree(this.directory);
    this.closed = true;
  }
}
