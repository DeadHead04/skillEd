// Modified for the skilled TypeScript distribution.
import { instrumentExec } from "./instrumentation.js";
import {
  Sandbox,
  type SandboxCreateOptions,
  type Execution,
  type WriteEntry,
} from "@alibaba-group/opensandbox";
import * as fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { quotePOSIX, type Shell } from "../platform/index.js";
import {
  RuntimeExecutionError,
  type Runtime,
  type RuntimeConfig,
  type ExecOptions,
  type ExecResult,
} from "./types.js";
function safeFileMode(mode: number | undefined): number {
  return mode && mode > 0 && mode <= 777 && /^[0-7]+$/.test(String(mode))
    ? parseInt(String(mode), 8)
    : 0o600;
}
function positive(
  raw: string | undefined,
  fallback: number,
  max = Infinity,
): number {
  const number = Number(raw);
  return Number.isInteger(number) && number > 0
    ? Math.min(number, max)
    : fallback;
}
function extensions(
  raw: string | undefined,
): Record<string, string> | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      Array.isArray(value) ||
      typeof value !== "object" ||
      Object.values(value).some((v) => typeof v !== "string")
    )
      return undefined;
    return value as Record<string, string>;
  } catch {
    return undefined;
  }
}
/** Race SDK methods without signal support against cancellation, retaining bounded SDK request timeout. */
async function bounded<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  timeoutMs = 30000,
): Promise<T> {
  signal?.throwIfAborted();
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("OpenSandbox operation timed out")),
          timeoutMs,
        );
        onAbort = () =>
          reject(
            signal?.reason ?? new Error("OpenSandbox operation cancelled"),
          );
        signal?.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}
export function executionToResult(execution: Execution): ExecResult {
  return {
    stdout: execution.logs.stdout.map((value) => value.text).join(""),
    stderr:
      execution.logs.stderr.map((value) => value.text).join("") ||
      execution.error?.traceback.join("\n") ||
      execution.error?.value ||
      "",
    exitCode: execution.exitCode ?? 0,
  };
}
export class OpenSandboxRuntime implements Runtime {
  private sandbox: Sandbox | undefined;
  private readonly directory: string;
  private config: RuntimeConfig;
  private pending: Promise<void> = Promise.resolve();
  private requestTimeoutMs = 30000;
  constructor(config: RuntimeConfig) {
    this.config = { ...config, env: { ...config.env } };
    this.directory = path.posix.normalize(
      (config.workspaceMount || "/workspace").replaceAll("\\", "/"),
    );
  }
  private serial(operation: () => Promise<void>): Promise<void> {
    const next = this.pending.then(operation);
    this.pending = next.catch(() => {});
    return next;
  }
  private requireSandbox(): Sandbox {
    if (!this.sandbox) throw new Error("opensandbox runtime is not created");
    return this.sandbox;
  }
  async create(signal?: AbortSignal): Promise<void> {
    return this.serial(async () => {
      if (this.sandbox) return;
      signal?.throwIfAborted();
      const baseURL =
        this.config.kwargs?.base_url?.trim() ||
        process.env.OPENSANDBOX_BASE_URL;
      const apiKey = process.env.OPENSANDBOX_API_KEY;
      const image =
        this.config.image?.trim() || this.config.sandboxTemplate?.trim();
      if (!baseURL)
        throw new Error(
          "opensandbox runtime requires environment.kwargs.base_url or OPENSANDBOX_BASE_URL",
        );
      if (!apiKey)
        throw new Error("opensandbox runtime requires OPENSANDBOX_API_KEY");
      if (!image)
        throw new Error(
          "opensandbox runtime requires environment.image or environment.sandbox_template",
        );
      this.requestTimeoutMs =
        positive(this.config.kwargs?.request_timeout_seconds, 30) * 1000;
      const options: SandboxCreateOptions = {
        connectionConfig: {
          domain: baseURL,
          apiKey,
          useServerProxy: this.config.useServerProxy,
          requestTimeoutSeconds: this.requestTimeoutMs / 1000,
        },
        image,
        entrypoint: this.config.entrypoint?.length
          ? this.config.entrypoint
          : ["tail", "-F", "/dev/null"],
        env: this.config.env,
        metadata: this.config.metadata,
        extensions: extensions(
          this.config.kwargs?.extensions || process.env.OPENSANDBOX_EXTENSIONS,
        ),
        readyTimeoutSeconds: this.config.readyTimeoutMs
          ? this.config.readyTimeoutMs / 1000
          : undefined,
        timeoutSeconds: this.config.sandboxTimeoutMs
          ? Math.max(1, Math.floor(this.config.sandboxTimeoutMs / 1000))
          : undefined,
        signal,
      };
      if (this.config.networkPolicy)
        options.networkPolicy = {
          defaultAction: "deny",
          egress:
            this.config.networkPolicy === "allow_declared"
              ? (this.config.allowedEgress ?? [])
                  .map((v) => v.trim())
                  .filter(Boolean)
                  .map((target) => ({ action: "allow" as const, target }))
              : undefined,
        };
      this.sandbox = await Sandbox.create(options);
      try {
        await this.ensureDirectory(this.directory, signal);
      } catch (error) {
        try {
          await this.destroy();
        } catch (cleanup) {
          throw new AggregateError(
            [error, cleanup],
            "sandbox creation and rollback failed",
          );
        }
        throw error;
      }
    });
  }
  private async destroy(): Promise<void> {
    if (!this.sandbox) return;
    const sandbox = this.sandbox;
    await bounded(sandbox.kill(), undefined, 30000);
    await bounded(sandbox.close(), undefined, 30000);
    this.sandbox = undefined;
  }
  async close(): Promise<void> {
    return this.serial(async () => {
      if (!this.sandbox) return;
      if (this.config.delete) await this.destroy();
      else {
        await bounded(this.sandbox.close(), undefined, 30000);
        this.sandbox = undefined;
      }
    });
  }
  async start(signal?: AbortSignal): Promise<void> {
    if (
      !(await bounded(
        this.requireSandbox().isHealthy(),
        signal,
        this.requestTimeoutMs,
      ))
    )
      throw new Error("opensandbox is unhealthy");
  }
  async stop(signal?: AbortSignal): Promise<void> {
    await bounded(this.requireSandbox().pause(), signal, this.requestTimeoutMs);
  }
  workspace(): string {
    return this.directory;
  }
  sandboxID(): string | undefined {
    return this.sandbox?.id;
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
  private remote(value: string): string {
    const clean = path.posix.normalize(value.replaceAll("\\", "/"));
    return !value || value === "."
      ? this.directory
      : path.posix.isAbsolute(clean)
        ? clean
        : path.posix.join(this.directory, clean);
  }
  private async ensureDirectory(
    directory: string,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    try {
      await bounded(
        this.requireSandbox().files.createDirectories([
          { path: directory, mode: 755 },
        ]),
        signal,
        this.requestTimeoutMs,
      );
    } catch (error) {
      signal?.throwIfAborted();
      const result = await this.exec(
        `mkdir -p ${quotePOSIX(directory)} && test -d ${quotePOSIX(directory)} && test -w ${quotePOSIX(directory)}`,
        { cwd: "/", signal, timeoutMs: 30000 },
      );
      if (result.exitCode !== 0) throw error;
    }
  }
  private async uploadBatch(
    items: { source: string; target: string }[],
    signal?: AbortSignal,
  ): Promise<void> {
    for (let i = 0; i < items.length; i += 128) {
      signal?.throwIfAborted();
      const streams: ReturnType<typeof createReadStream>[] = [];
      try {
        const entries: WriteEntry[] = [];
        for (const item of items.slice(i, i + 128)) {
          const info = await fs.stat(item.source);
          if (!info.isFile())
            throw new Error(
              "upload source is not a regular file: " + item.source,
            );
          const stream = createReadStream(item.source);
          streams.push(stream);
          entries.push({
            path: item.target,
            data: stream,
            mode: parseInt((info.mode & 0o777).toString(8), 10),
          });
        }
        if (entries.length)
          await bounded(
            this.requireSandbox().files.writeFiles(entries),
            signal,
            this.requestTimeoutMs,
          );
      } finally {
        for (const stream of streams) stream.destroy();
      }
    }
  }
  async uploadFile(
    source: string,
    target: string,
    signal?: AbortSignal,
  ): Promise<void> {
    this.requireSandbox();
    const remote = this.remote(target);
    await this.ensureDirectory(path.posix.dirname(remote), signal);
    await this.uploadBatch([{ source, target: remote }], signal);
  }
  async uploadDir(
    source: string,
    target: string,
    signal?: AbortSignal,
  ): Promise<void> {
    this.requireSandbox();
    const root = this.remote(target),
      dirs = [root],
      items: { source: string; target: string }[] = [];
    async function walk(local: string, remote: string): Promise<void> {
      for (const entry of await fs.readdir(local, { withFileTypes: true })) {
        signal?.throwIfAborted();
        const src = path.join(local, entry.name),
          dst = path.posix.join(remote, entry.name);
        if (entry.isDirectory()) {
          dirs.push(dst);
          await walk(src, dst);
        } else items.push({ source: src, target: dst });
      }
    }
    await walk(source, root);
    const mkdir = await this.exec(
      "mkdir -p " + dirs.map(quotePOSIX).join(" "),
      { cwd: "/", timeoutMs: 30000, signal },
    );
    if (mkdir.exitCode !== 0)
      throw new RuntimeExecutionError("sandbox mkdir failed", mkdir);
    await this.uploadBatch(items, signal);
  }
  private async download(
    remote: string,
    target: string,
    mode: number | undefined,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    await fs.mkdir(path.dirname(target), { recursive: true });
    const handle = await fs.open(target, "w", safeFileMode(mode));
    try {
      for await (const chunk of this.requireSandbox().files.readBytesStream(
        remote,
      )) {
        signal?.throwIfAborted();
        let offset = 0;
        while (offset < chunk.length) {
          const result = await handle.write(
            chunk,
            offset,
            chunk.length - offset,
          );
          offset += result.bytesWritten;
        }
      }
    } finally {
      await handle.close();
    }
  }
  async downloadFile(
    source: string,
    target: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.download(this.remote(source), target, undefined, signal);
  }
  async downloadDir(
    source: string,
    target: string,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    const remote = this.remote(source);
    const files = await bounded(
      this.requireSandbox().files.search({ path: remote, pattern: "**" }),
      signal,
      this.requestTimeoutMs,
    );
    await fs.mkdir(target, { recursive: true });
    let index = 0;
    const errors: unknown[] = [];
    await Promise.all(
      Array.from(
        {
          length: Math.min(
            files.length,
            positive(this.config.kwargs?.file_transfer_parallelism, 8, 64),
          ),
        },
        async () => {
          while (index < files.length && !errors.length) {
            const file = files[index++]!;
            try {
              signal?.throwIfAborted();
              const rel = path.posix.relative(remote, file.path);
              if (!rel) continue;
              if (
                rel === ".." ||
                rel.startsWith("../") ||
                path.posix.isAbsolute(rel) ||
                rel.includes("\\") ||
                /^[A-Za-z]:/.test(rel)
              )
                throw new Error(
                  "sandbox search result is outside source directory: " +
                    file.path,
                );
              const local = path.join(target, rel);
              if (file.type === "directory")
                await fs.mkdir(local, { recursive: true });
              else await this.download(file.path, local, file.mode, signal);
            } catch (error) {
              errors.push(error);
            }
          }
        },
      ),
    );
    if (errors.length) throw errors[0];
  }
  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    return instrumentExec(
      "opensandbox",
      command,
      { ...options, cwd: options.cwd || this.directory },
      () => this.execute(command, options),
    );
  }
  private async execute(
    command: string,
    options: ExecOptions,
  ): Promise<ExecResult> {
    const sandbox = this.requireSandbox();
    options.signal?.throwIfAborted();
    const signal = options.timeoutMs
      ? AbortSignal.any([
          ...(options.signal ? [options.signal] : []),
          AbortSignal.timeout(options.timeoutMs),
        ])
      : options.signal;
    let stdout = "",
      stderr = "",
      executionID = "";
    try {
      const execution = await sandbox.commands.run(
        command,
        {
          workingDirectory: this.remote(options.cwd || "."),
          envs: { ...this.config.env, ...options.env },
          timeoutSeconds: options.timeoutMs
            ? options.timeoutMs / 1000
            : undefined,
        },
        {
          onInit: (value) => {
            executionID = value.id;
          },
          onStdout: (message) => {
            stdout += message.text;
          },
          onStderr: (message) => {
            stderr += message.text;
          },
        },
        signal,
      );
      return executionToResult(execution);
    } catch (cause) {
      if (signal?.aborted && executionID) {
        try {
          await bounded(
            sandbox.commands.interrupt(executionID),
            undefined,
            30000,
          );
        } catch (cleanup) {
          throw new RuntimeExecutionError(
            "opensandbox cancellation cleanup failed",
            { stdout, stderr, exitCode: -1 },
            { cause: new AggregateError([cause, cleanup]) },
          );
        }
      }
      throw new RuntimeExecutionError(
        "opensandbox exec failed",
        { stdout, stderr, exitCode: -1 },
        { cause },
      );
    }
  }
}
