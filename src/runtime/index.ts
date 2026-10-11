// Modified for the skilled TypeScript distribution.
export * from "./types.js";
export * from "./none.js";
export * from "./docker.js";
export * from "./opensandbox.js";
export { runProcess, mergedEnv } from "./process.js";
import type { Runtime, RuntimeConfig } from "./types.js";
import { NoneRuntime } from "./none.js";
import { DockerRuntime } from "./docker.js";
import { OpenSandboxRuntime } from "./opensandbox.js";
import { validateShell } from "../platform/index.js";
export function createRuntime(config: RuntimeConfig): Runtime {
  let runtime: Runtime;
  switch (config.type) {
    case "none":
      runtime = new NoneRuntime(config);
      break;
    case "docker":
      runtime = new DockerRuntime(config);
      break;
    case "opensandbox":
      runtime = new OpenSandboxRuntime(config);
      break;
    default:
      throw new Error("unknown runtime type: " + String(config.type));
  }
  validateShell(runtime.shell());
  return runtime;
}
export const newRuntime = createRuntime;
