import { spawn, type ChildProcess } from "node:child_process";
const active = new Set<ChildProcess>();
export function executionEnvironment(): Record<string, string> {
  const env: Record<string, string> = { TZ: "UTC" };
  for (const key of [
    "PATH",
    "HOME",
    "CODEX_HOME",
    "TMPDIR",
    "CODEX_CA_CERTIFICATE",
    "SSL_CERT_FILE",
  ])
    if (process.env[key]) env[key] = process.env[key];
  if (process.env.SKILLED_SCRIPT_SANDBOX)
    env.SKILLED_SCRIPT_SANDBOX = process.env.SKILLED_SCRIPT_SANDBOX;
  return env;
}
export function signalTree(child: ChildProcess, signal: NodeJS.Signals) {
  // The parent can exit while descendants still hold its process group open.
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
export function stopExecutions(signal: NodeJS.Signals = "SIGTERM") {
  for (const child of active) signalTree(child, signal);
}
export async function executeBounded(
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs?: number;
    cancelled?: () => Promise<boolean>;
    onStdout?: (chunk: string) => void;
  },
) {
  if (await options.cancelled?.())
    return {
      stdout: "",
      stderr: "",
      exitCode: null,
      cancelled: true,
      timedOut: false,
      outputLimited: false,
    };
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: executionEnvironment(),
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  active.add(child);
  let stdout = "",
    stderr = "",
    cancelled = false,
    timedOut = false,
    bytes = 0,
    outputLimited = false;
  let killTimer: NodeJS.Timeout | undefined;
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    signalTree(child, "SIGTERM");
    killTimer ??= setTimeout(() => signalTree(child, "SIGKILL"), 5000);
  };
  const append = (chunk: Buffer, stream: "stdout" | "stderr") => {
    const remaining = Math.max(0, 10 * 1024 * 1024 - bytes);
    bytes += chunk.length;
    const value = chunk.subarray(0, remaining).toString();
    if (stream === "stdout") {
      stdout += value;
      options.onStdout?.(value);
    } else stderr += value;
    if (bytes > 10 * 1024 * 1024) {
      outputLimited = true;
      stop();
    }
  };
  child.stdout.on("data", (chunk) => append(chunk, "stdout"));
  child.stderr.on("data", (chunk) => append(chunk, "stderr"));
  const timer = setTimeout(
    () => {
      timedOut = true;
      stop();
    },
    options.timeoutMs ?? 2 * 60 * 60_000,
  );
  let polling = false;
  const poll = setInterval(() => {
    if (!options.cancelled || polling) return;
    polling = true;
    void options
      .cancelled()
      .then((value) => {
        if (value) {
          cancelled = true;
          stop();
        }
      })
      .catch(() => {
        cancelled = true;
        stop();
      })
      .finally(() => {
        polling = false;
      });
  }, 750);
  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    return { stdout, stderr, exitCode, cancelled, timedOut, outputLimited };
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
    if (killTimer) clearTimeout(killTimer);
    signalTree(child, "SIGKILL");
    active.delete(child);
  }
}
