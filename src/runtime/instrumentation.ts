// Modified for the skilled TypeScript distribution.
import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { tracer, recordRuntimeExec } from "../observability/index.js";
import {
  warnContextf,
  errorContextf,
  debugContextf,
} from "../logging/index.js";
import {
  RuntimeExecutionError,
  type ExecOptions,
  type ExecResult,
} from "./types.js";
export const maskCommand = (command: string): string =>
  Array.from(command).length > 200
    ? Array.from(command).slice(0, 200).join("") + "..."
    : command;
export async function instrumentExec(
  type: string,
  command: string,
  options: ExecOptions,
  operation: () => Promise<ExecResult>,
): Promise<ExecResult> {
  const parent = options.context ?? context.active();
  const span = tracer().startSpan(
    "runtime.exec",
    {
      attributes: {
        "process.command": command,
        "process.cwd": options.cwd ?? "",
        "runtime.type": type,
      },
    },
    parent,
  );
  const ctx = trace.setSpan(parent, span);
  const start = performance.now();
  let failed = false;
  let result: ExecResult = { stdout: "", stderr: "", exitCode: -1 };
  try {
    result = await context.with(ctx, operation);
    return result;
  } catch (error) {
    failed = true;
    if (error instanceof RuntimeExecutionError) result = error.result;
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    errorContextf(
      ctx,
      options.signal?.aborted ||
        (error instanceof Error && /timed out/.test(error.message))
        ? "command killed by context (%s); command: %s"
        : "runtime execution failed: %s; command: %s",
      error instanceof Error ? error.message : String(error),
      maskCommand(command),
    );
    throw error;
  } finally {
    span.setAttribute("process.exit_code", result.exitCode);
    recordRuntimeExec(ctx, result.exitCode, performance.now() - start);
    if (result.exitCode !== 0) {
      const log = result.exitCode === 1 ? warnContextf : errorContextf;
      if (!failed)
        log(
          ctx,
          "command exited with code %d: %s",
          result.exitCode,
          maskCommand(command),
        );
      if (result.stderr) log(ctx, "stderr: %s", result.stderr);
      if (result.stdout) log(ctx, "stdout: %s", result.stdout);
    } else if (result.stderr) warnContextf(ctx, "stderr: %s", result.stderr);
    debugContextf(
      ctx,
      "runtime exec duration_ms=%d",
      Math.round(performance.now() - start),
    );
    span.end();
  }
}
