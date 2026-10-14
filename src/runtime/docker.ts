// Modified for the skilled TypeScript distribution.
import { instrumentExec } from "./instrumentation.js";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { copyJudgeTree, removeOwnedTree } from "./files.js";
import { type Shell } from "../platform/index.js";
import { runProcess } from "./process.js";
import {
  RuntimeExecutionError,
  type Runtime,
  type RuntimeConfig,
  type ExecOptions,
  type ExecResult,
  type JudgeSnapshot,
  type JudgeSnapshotProvider,
} from "./types.js";
export class DockerRuntime implements Runtime, JudgeSnapshotProvider {
  private id = "";
  private started = false;
  private readonly directory: string;
  private config: RuntimeConfig;
  private pending: Promise<void> = Promise.resolve();
  private privateFiles: { directory: string; path: string }[] = [];
  constructor(config: RuntimeConfig) {
    if (!config.image?.trim())
      throw new Error("docker runtime requires environment.image");
    if (config.networkPolicy === "allow_declared")
      throw new Error(
        "docker runtime: network_policy=allow_declared is not supported; use deny_all or opensandbox",
      );
    const workspace = config.workspaceMount?.trim() || "/workspace";
    if (!path.posix.isAbsolute(workspace))
      throw new Error("docker workspace_mount must be absolute");
    this.directory = path.posix.normalize(workspace);
    this.config = { ...config, env: { ...config.env } };
  }
  private serial(operation: () => Promise<void>): Promise<void> {
    const next = this.pending.then(operation);
    this.pending = next.catch(() => {});
    return next;
  }
  private async command(
    args: string[],
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<ExecResult> {
    return runProcess("docker", args, { signal, timeoutMs });
  }
  private async checked(
    args: string[],
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<void> {
    const result = await this.command(args, signal, timeoutMs);
    if (result.exitCode !== 0)
      throw new RuntimeExecutionError(
        `docker ${args[0]} failed: ${result.stderr.trim()}`,
        result,
      );
  }
  async create(signal?: AbortSignal): Promise<void> {
    return this.serial(async () => {
      if (this.id) return;
      signal?.throwIfAborted();
      const name = "skilled-" + randomBytes(6).toString("hex");
      const entry = this.config.entrypoint?.length
        ? this.config.entrypoint
        : ["sleep", "infinity"];
      const args = ["create", "--name", name, "--workdir", this.directory];
      if (this.config.networkPolicy === "deny_all")
        args.push("--network", "none");
      for (const [key, value] of Object.entries(this.config.env ?? {}))
        args.push("--env", key + "=" + value);
      args.push(
        "--entrypoint",
        entry[0]!,
        this.config.image!,
        ...entry.slice(1),
      );
      const result = await this.command(args, signal);
      if (result.exitCode !== 0)
        throw new RuntimeExecutionError(
          "docker create failed: " + result.stderr,
          result,
        );
      this.id = result.stdout.trim() || name;
      try {
        await this.checked(["start", this.id], signal);
        this.started = true;
        await this.checked(
          ["exec", this.id, "mkdir", "-p", this.directory],
          signal,
        );
      } catch (error) {
        try {
          await this.checked(["rm", "-f", this.id], undefined, 30000);
          this.id = "";
          this.started = false;
        } catch (cleanup) {
          throw new AggregateError(
            [error, cleanup],
            "docker creation and rollback failed",
          );
        }
        throw error;
      }
    });
  }
  async close(): Promise<void> {
    return this.serial(async () => {
      if (!this.id) return;
      let privateCleanupError: unknown;
      try {
        await this.clearPrivateFiles();
      } catch (error) {
        privateCleanupError = error;
      }
      await this.checked(
        this.config.delete
          ? ["rm", "-f", this.id]
          : ["stop", "--time", "5", this.id],
        undefined,
        30000,
      );
      this.started = false;
      if (this.config.delete) this.privateFiles = [];
      else if (privateCleanupError) throw privateCleanupError;
      this.id = "";
    });
  }
  async start(signal?: AbortSignal): Promise<void> {
    return this.serial(async () => {
      this.ensureCreated();
      if (!this.started) {
        await this.checked(["start", this.id], signal);
        this.started = true;
      }
    });
  }
  async stop(signal?: AbortSignal): Promise<void> {
    return this.serial(async () => {
      if (!this.id) return;
      if (this.started) {
        try {
          await this.clearPrivateFiles();
        } finally {
          await this.checked(["stop", "--time", "5", this.id], signal);
          this.started = false;
        }
      }
    });
  }
  workspace(): string {
    return this.directory;
  }
  containerID(): string {
    return this.id;
  }
  async stagePrivateFile(
    source: string,
    name = "auth.json",
    signal?: AbortSignal,
  ): Promise<{ directory: string; path: string }> {
    this.ensureCreated();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))
      throw new Error("private file name must be a simple filename");
    if (!(await fs.lstat(source)).isFile())
      throw new Error("private file source must be a regular file, not a symlink");
    const directory = "/tmp/skilled-private-" + randomBytes(12).toString("hex");
    const entry = { directory, path: directory + "/" + name };
    await this.checked(["exec", this.id, "mkdir", "-m", "700", directory], signal);
    this.privateFiles.push(entry);
    await this.checked(["cp", source, this.id + ":" + entry.path], signal);
    await this.checked(["exec", this.id, "chmod", "600", entry.path], signal);
    return entry;
  }
  private async clearPrivateFiles(): Promise<void> {
    if (!this.privateFiles.length) return;
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skilled-private-cleanup-"));
    const empty = path.join(root, "empty");
    await fs.writeFile(empty, "", { mode: 0o600 });
    try {
      while (this.privateFiles.length) {
        const entry = this.privateFiles[0]!;
        // Docker cp works on stopped containers and does not run code in the
        // agent-modified root filesystem. Erase credentials before retaining it.
        await this.checked(["cp", empty, this.id + ":" + entry.path], undefined, 30000);
        if (this.started) {
          const removed = await this.command(["exec", this.id, "rm", "-rf", "--", entry.directory], undefined, 30000);
          if (removed.exitCode !== 0)
            throw new RuntimeExecutionError("failed to remove private runtime files", removed);
        }
        this.privateFiles.shift();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
  async captureJudgeSnapshot(signal?: AbortSignal): Promise<JudgeSnapshot> {
    this.ensureCreated();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skilled-docker-judge-"));
    const source = path.join(root, "source"),
      snapshot = path.join(root, "snapshot");
    try {
      await this.downloadDir(".", source, signal);
      // Validate links and special files before copying untrusted workspace data
      // into a fresh grading container. Never commit the SUT container image.
      await copyJudgeTree(source, snapshot, signal);
      await removeOwnedTree(source);
      let closed = false;
      return {
        fork: async (forkSignal, prepare) => {
          if (closed) throw new Error("snapshot is closed");
          const runtime = new DockerRuntime({
            ...this.config, env: { ...this.config.env }, delete: true,
          });
          try {
            await runtime.create(forkSignal);
            // Trusted provisioning happens before any agent-modified files
            // exist: setup must not load an injected package script or config.
            for (const step of this.config.setupSteps ?? []) {
              const setup = await runtime.exec(step.run, { signal: forkSignal });
              if (setup.exitCode !== 0)
                throw new Error("judge setup step failed: " + setup.stderr);
            }
            await prepare?.(runtime);
            await runtime.uploadDir(snapshot, ".", forkSignal);
            return { runtime, cleanup: () => runtime.close() };
          } catch (error) {
            await runtime.close();
            throw error;
          }
        },
        close: async () => {
          closed = true;
          await removeOwnedTree(root);
        },
      };
    } catch (error) {
      await removeOwnedTree(root);
      throw error;
    }
  }
  requiresProcessSandbox(): boolean {
    return false;
  }
  shell(): Shell {
    return { goos: "linux", family: "posix" };
  }
  mergeEnv(env: Record<string, string>): void {
    Object.assign(this.config.env!, env);
  }
  private ensureCreated(): void {
    if (!this.id) throw new Error("docker runtime has not been created");
  }
  private remote(value: string): string {
    const normalized = path.posix.normalize(value);
    if (path.posix.isAbsolute(normalized)) return normalized;
    const target = path.posix.join(this.directory, normalized);
    if (target !== this.directory && !target.startsWith(this.directory + "/"))
      throw new Error("remote path escapes workspace");
    return target;
  }

  async uploadFile(
    source: string,
    target: string,
    signal?: AbortSignal,
  ): Promise<void> {
    this.ensureCreated();
    const remote = this.remote(target);
    await this.checked(
      ["exec", this.id, "mkdir", "-p", path.posix.dirname(remote)],
      signal,
    );
    await this.checked(["cp", source, this.id + ":" + remote], signal);
  }
  async uploadDir(
    source: string,
    target: string,
    signal?: AbortSignal,
  ): Promise<void> {
    this.ensureCreated();
    const remote = this.remote(target);
    await this.checked(["exec", this.id, "mkdir", "-p", remote], signal);
    await this.checked(
      [
        "cp",
        source.replace(/[\\/]+$/, "") + path.sep + ".",
        this.id + ":" + remote,
      ],
      signal,
    );
  }
  async downloadFile(
    source: string,
    target: string,
    signal?: AbortSignal,
  ): Promise<void> {
    this.ensureCreated();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await this.checked(
      ["cp", this.id + ":" + this.remote(source), target],
      signal,
    );
  }
  async downloadDir(
    source: string,
    target: string,
    signal?: AbortSignal,
  ): Promise<void> {
    this.ensureCreated();
    await fs.mkdir(target, { recursive: true });
    await this.checked(
      ["cp", this.id + ":" + this.remote(source) + "/.", target],
      signal,
    );
  }
  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    return instrumentExec(
      "docker",
      command,
      { ...options, cwd: options.cwd || this.directory },
      () => this.execute(command, options),
    );
  }
  private async execute(
    command: string,
    options: ExecOptions,
  ): Promise<ExecResult> {
    this.ensureCreated();
    const args = [
      "exec",
      "--workdir",
      options.cwd ? this.remote(options.cwd) : this.directory,
    ];
    for (const [key, value] of Object.entries({
      ...this.config.env,
      ...options.env,
    }))
      args.push("--env", key + "=" + value);
    args.push(this.id, "sh", "-c", command);
    const result = await this.command(args, options.signal, options.timeoutMs);
    if (
      result.exitCode !== 0 &&
      /^(Error response from daemon:|Error: No such container|OCI runtime exec failed:|Cannot connect to the Docker daemon|error during connect:)/.test(
        result.stderr.trim(),
      )
    )
      throw new RuntimeExecutionError(
        "docker exec infrastructure failure",
        result,
      );
    return result;
  }
}
