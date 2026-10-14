#!/usr/bin/env node
// Modified for the skilled TypeScript distribution.
import { VERSION } from "./brand.js";
import { execute } from "./api/index.js";
import { supervisorHeartbeatType, supervisorLeaseMs } from "./mcp/supervision.js";
const controller = new AbortController();
const leaseRequired = process.env.SKILLED_MCP_SUPERVISED === "1" && !!process.send;
// Start the lease before the first message so an immediately lost supervisor
// cannot leave a permanently unmonitored evaluation.
let lastSupervisorHeartbeat = performance.now();
const interrupt = () => controller.abort(new Error("Interrupted by SIGINT"));
const terminate = () => controller.abort(new Error("Interrupted by SIGTERM"));
const cancel = (message: unknown) => {
  if (message && typeof message === "object" && "type" in message) {
    if (message.type === "skilled.cancel")
      controller.abort(new Error("Evaluation cancelled by MCP client"));
    else if (leaseRequired && message.type === supervisorHeartbeatType)
      lastSupervisorHeartbeat = performance.now();
  }
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", terminate);
const disconnect = () => controller.abort(new Error("Evaluation supervisor disconnected"));
let supervisorWatch: NodeJS.Timeout | undefined;
if (process.send) {
  // An abruptly terminated Windows supervisor can close its capture pipes
  // before IPC emits disconnect. An unhandled stream error would terminate
  // this CLI while asynchronous taskkill cleanup is still running.
  const channelError = (error: Error) => {
    process.exitCode = 1;
    controller.abort(new Error("Evaluation supervisor channel failed", { cause: error }));
  };
  process.stdout.on("error", channelError);
  process.stderr.on("error", channelError);
  process.on("error", channelError);
  process.on("message", cancel);
  process.once("disconnect", disconnect);
  // Use only our current OS parent, never a PID loaded from persisted job
  // metadata. This is a read-only liveness check, not a termination signal.
  const supervisorPid = process.ppid;
  supervisorWatch = setInterval(() => {
    if (controller.signal.aborted) return;
    // A terminated Windows parent may still have open process/pipe handles.
    // Require active renewal rather than treating a PID or IPC handle as proof
    // that the supervisor is still running.
    if (leaseRequired && performance.now() - lastSupervisorHeartbeat >= supervisorLeaseMs) {
      process.exitCode = 1;
      controller.abort(new Error("Evaluation supervisor heartbeat expired"));
      return;
    }
    try { process.kill(supervisorPid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") disconnect();
    }
  }, 250);
  supervisorWatch.unref();
  // Keep channel error handlers installed through the final buffered writes.
}
try {
  await execute(VERSION, process.argv.slice(2), { signal: controller.signal });
} catch {
  process.exitCode = 1;
} finally {
  clearInterval(supervisorWatch);
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", terminate);
  process.removeListener("message", cancel);
  process.removeListener("disconnect", disconnect);
  if (process.connected) process.disconnect();
}
