import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { supervisorHeartbeatMs, supervisorHeartbeatType } from "./supervision.js";
const bootstrap = fileURLToPath(new URL("../bootstrap.js", import.meta.url));
const maxResponseBytes = 64 * 1024;
/** Execute the installed CLI with bounded capture and graceful cancellation before forced termination. */
export async function runMcpCli(
  args: string[],
  workspace: string,
  signal: AbortSignal,
  timeoutSeconds: number,
) {
  signal.throwIfAborted();
  return new Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    truncated: boolean;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, [bootstrap, ...args], {
      cwd: workspace,
      env: { ...process.env, NO_COLOR: "1", SKILLED_MCP_SUPERVISED: "1" },
      // Windows libuv assigns non-detached children to the parent's kill-on-
      // close job. The evaluation must survive supervisor death long enough
      // to expire its lease and clean up shell descendants itself.
      detached: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let stdout: Buffer = Buffer.alloc(0),
      stderr: Buffer = Buffer.alloc(0),
      truncated = false,
      stopped: Error | undefined,
      settled = false;
    let escalation: NodeJS.Timeout | undefined,
      drain: NodeJS.Timeout | undefined,
      heartbeat: NodeJS.Timeout | undefined;
    const capture = (previous: Buffer, chunk: Buffer): Buffer => {
      if (previous.length + chunk.length > maxResponseBytes / 3)
        truncated = true;
      return Buffer.concat([previous, chunk]).subarray(0, maxResponseBytes / 3);
    };
    const kill = (force: boolean) => {
      if (!child.pid) return;
      if (!force && child.connected) {
        child.send({ type: "skilled.cancel" }, (error) => {
          if (error) kill(true);
        });
        return;
      }
      if (process.platform === "win32") {
        const killer = spawn(
          "taskkill",
          ["/PID", String(child.pid), "/T", "/F"],
          { stdio: "ignore", windowsHide: true },
        );
        killer.on("error", () => child.kill("SIGKILL"));
        killer.unref();
      } else
        try {
          process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH")
            child.kill(force ? "SIGKILL" : "SIGTERM");
        }
    };
    const finish = (code: number | null, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(escalation);
      clearTimeout(drain);
      clearInterval(heartbeat);
      signal.removeEventListener("abort", abort);
      if (stopped || error) reject(stopped ?? error);
      else
        resolve({
          exitCode: code ?? -1,
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
          truncated,
        });
    };
    const stop = (reason: Error) => {
      if (settled || stopped) return;
      stopped = reason;
      kill(false);
      escalation = setTimeout(() => {
        kill(true);
        drain = setTimeout(() => {
          child.stdout!.destroy();
          child.stderr!.destroy();
          finish(child.exitCode);
        }, 2000);
      }, 10000);
    };
    const abort = () =>
      stop(
        new Error(
          "Evaluation cancelled; partial reports may remain in outputDir",
        ),
      );
    const timeout = setTimeout(
      () =>
        stop(
          new Error(
            "Evaluation time limit reached; partial reports may remain in outputDir",
          ),
        ),
      timeoutSeconds * 1000,
    );
    child.stdout!.on("data", (data: Buffer) => {
      stdout = capture(stdout, data);
    });
    child.stderr!.on("data", (data: Buffer) => {
      stderr = capture(stderr, data);
    });
    child.on("error", (error) => finish(-1, error));
    child.on("close", (code) => finish(code));
    child.on("exit", () => {
      drain ??= setTimeout(() => {
        child.stdout!.destroy();
        child.stderr!.destroy();
        finish(child.exitCode);
      }, 2000);
    });
    signal.addEventListener("abort", abort, { once: true });
    const renewLease = () => {
      if (settled || stopped) return;
      // The CLI disconnects IPC normally before its final pipes/exit drain.
      // Its close event (or execution deadline) owns that completion path.
      if (!child.connected) return;
      child.send({ type: supervisorHeartbeatType }, (error) => {
        if (error && child.connected)
          stop(new Error("Evaluation supervisor heartbeat failed", { cause: error }));
      });
    };
    heartbeat = setInterval(renewLease, supervisorHeartbeatMs);
    heartbeat.unref();
    renewLease();
    if (signal.aborted) abort();
  });
}
