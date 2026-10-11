// Modified for the skilled TypeScript distribution.
import { spawn } from "node:child_process";
import type { ExecResult } from "./types.js";
import { RuntimeExecutionError } from "./types.js";
export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  graceMs?: number;
  waitDelayMs?: number;
  windowsVerbatimArguments?: boolean;
}
/** Execute a real process; nonzero exits are results, cancellation/spawn failures carry partial output. */
export async function runProcess(
  executable: string,
  args: string[],
  options: ProcessOptions = {},
): Promise<ExecResult> {
  if (options.signal?.aborted)
    throw new RuntimeExecutionError(
      options.signal.reason instanceof Error
        ? options.signal.reason.message
        : "execution cancelled",
      { stdout: "", stderr: "", exitCode: -1 },
      { cause: options.signal.reason },
    );
  return new Promise((resolve, reject) => {
    let stdout = "",
      stderr = "",
      finished = false,
      cause: unknown;
    let timeout: NodeJS.Timeout | undefined,
      escalation: NodeJS.Timeout | undefined,
      pipeDeadline: NodeJS.Timeout | undefined;
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: process.platform !== "win32",
      windowsHide: true,
      windowsVerbatimArguments: options.windowsVerbatimArguments,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const finish = (code: number | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      clearTimeout(escalation);
      clearTimeout(pipeDeadline);
      options.signal?.removeEventListener("abort", abort);
      const result = { stdout, stderr, exitCode: cause ? -1 : (code ?? -1) };
      cause
        ? reject(
            new RuntimeExecutionError(
              cause instanceof Error ? cause.message : "execution cancelled",
              result,
              { cause },
            ),
          )
        : resolve(result);
    };
    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        const killer = spawn(
          "taskkill",
          ["/pid", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.on("error", () => child.kill(signal));
        killer.unref();
      } else
        try {
          process.kill(-child.pid, signal);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH")
            child.kill(signal);
        }
    };
    const abort = () => {
      if (finished || cause) return;
      cause = options.signal?.reason ?? new Error("execution cancelled");
      kill("SIGTERM");
      escalation = setTimeout(() => kill("SIGKILL"), options.graceMs ?? 1000);
      pipeDeadline = setTimeout(() => {
        kill("SIGKILL");
        child.stdout.destroy();
        child.stderr.destroy();
        finish(child.exitCode);
      }, options.waitDelayMs ?? 2000);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (v: string) => (stdout += v));
    child.stderr.on("data", (v: string) => (stderr += v));
    child.on("error", (error) => {
      cause = error;
      finish(-1);
    });
    child.on("close", (code) => finish(code));
    // A descendant may retain inherited pipes after its parent exits. Bound drain time.
    child.on("exit", () => {
      if (!finished && !pipeDeadline)
        pipeDeadline = setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          finish(child.exitCode);
        }, options.waitDelayMs ?? 2000);
    });
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    if (options.timeoutMs && options.timeoutMs > 0)
      timeout = setTimeout(() => {
        abort();
        if (cause instanceof Error && cause.message === "execution cancelled")
          cause = new Error("execution timed out");
      }, options.timeoutMs);
  });
}
export function mergedEnv(
  base: Record<string, string> = {},
  call: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return { ...process.env, ...base, ...call };
}
