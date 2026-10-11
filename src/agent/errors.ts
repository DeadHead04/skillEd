// Modified for the skilled TypeScript distribution.
export const errAgentNotFound = new Error("agent not found in PATH");
export const errAgentRequiresBash = new Error(
  "agent CLI execution on Windows requires a bash target shell",
);
export const errAgentInstallFailed = new Error("agent installation failed");
export class UnsupportedAgentError extends Error {
  constructor(readonly engineName: string) {
    super(
      `unsupported agent ${JSON.stringify(engineName)}: missing engine.custom`,
    );
    this.name = "UnsupportedAgentError";
  }
}
import type { SessionResult } from "./types.js";
/** Retains the partial result returned alongside an error by the original agent contract. */
export class AgentExecutionError extends Error {
  constructor(
    message: string,
    readonly result: SessionResult,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AgentExecutionError";
  }
}
