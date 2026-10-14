#!/usr/bin/env node
// Modified for the skilled TypeScript distribution.
import { VERSION } from "./brand.js";
import { execute } from "./api/index.js";
const controller = new AbortController();
const interrupt = () => controller.abort(new Error("Interrupted by SIGINT"));
const terminate = () => controller.abort(new Error("Interrupted by SIGTERM"));
const cancel = (message: unknown) => {
  if (message && typeof message === "object" && "type" in message && message.type === "skilled.cancel")
    controller.abort(new Error("Evaluation cancelled by MCP client"));
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", terminate);
const disconnect = () => controller.abort(new Error("Evaluation supervisor disconnected"));
if (process.send) {
  process.on("message", cancel);
  process.once("disconnect", disconnect);
}
try {
  await execute(VERSION, process.argv.slice(2), { signal: controller.signal });
} catch {
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", terminate);
  process.removeListener("message", cancel);
  process.removeListener("disconnect", disconnect);
  if (process.connected) process.disconnect();
}
