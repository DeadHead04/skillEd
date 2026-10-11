// Modified for the skilled TypeScript distribution.
import type { Context } from "@opentelemetry/api";
import type { Runtime, ExecResult } from "../runtime/types.js";
import { RuntimeExecutionError } from "../runtime/types.js";
import { NoneRuntime } from "../runtime/none.js";
import { combinedSignal } from "../agent/custom-support.js";
import { warnf } from "../logging/index.js";
import {
  newResult,
  newErrorResult,
  resolveInput,
  type Judge,
  type Input,
  type ResolvedInput,
  type Result,
} from "./types.js";
import { planScript, judgeTempDir, joinForGOOS } from "./interpreter.js";
export const defaultScriptTimeoutMs = 30000;
export class JudgeEvaluationError extends Error {
  constructor(
    error: Error,
    readonly result: Result,
  ) {
    super(error.message, { cause: error });
  }
}
export class ScriptJudge implements Judge {
  timeoutIsError = false;
  transcriptPath = "";
  constructor(
    public scriptPath: string,
    public timeoutSeconds = 0,
    public runtime: Runtime | null = null,
  ) {}
  async evaluate(
    input: Input,
    signal?: AbortSignal,
    context?: Context,
  ): Promise<Result> {
    if (!this.transcriptPath)
      warnf(
        "ScriptJudge.TranscriptPath is empty; EVAL_TRANSCRIPT_PATH will be unset",
      );
    const timeout =
      this.timeoutSeconds > 0
        ? this.timeoutSeconds * 1000
        : defaultScriptTimeoutMs;
    const bounded = combinedSignal(signal, timeout);
    const own = !this.runtime,
      rt = this.runtime ?? new NoneRuntime({ type: "none", delete: true });
    if (own)
      try {
        await rt.create(bounded);
      } catch (e) {
        throw new Error(
          `script execution failed: create none runtime workspace: ${(e as Error).message}`,
          { cause: e },
        );
      }
    try {
      return await this.evaluateInRuntime(
        rt,
        resolveInput(input),
        timeout,
        bounded,
        context,
      );
    } finally {
      if (own) await rt.close();
    }
  }
  async evaluateInRuntime(
    rt: Runtime,
    input: ResolvedInput,
    timeoutMs: number,
    signal?: AbortSignal,
    context?: Context,
  ): Promise<Result> {
    let plan;
    try {
      plan = await planScript(this.scriptPath, rt.shell());
    } catch (e) {
      throw new Error(`script execution failed: ${(e as Error).message}`, {
        cause: e,
      });
    }
    const dir = judgeTempDir(rt.shell().goos),
      script = joinForGOOS(rt.shell().goos, dir, plan.uploadName);
    try {
      await rt.uploadFile(this.scriptPath, script, signal);
    } catch (e) {
      throw new Error(
        `script execution failed: upload script judge: ${(e as Error).message}`,
        { cause: e },
      );
    }
    try {
      let transcript = "";
      if (this.transcriptPath) {
        transcript = joinForGOOS(rt.shell().goos, dir, "transcript.json");
        try {
          await rt.uploadFile(this.transcriptPath, transcript, signal);
        } catch (e) {
          throw new Error(
            `script execution failed: upload script judge transcript: ${(e as Error).message}`,
            { cause: e },
          );
        }
      }
      let result: ExecResult = { stdout: "", stderr: "", exitCode: 0 },
        error: Error | undefined;
      try {
        result = await rt.exec(plan.command(script), {
          cwd: input.workspacePath || rt.workspace(),
          timeoutMs,
          env: {
            EVAL_TRANSCRIPT_PATH: transcript ? plan.envPath(transcript) : "",
            EVAL_FINAL_MESSAGE: input.finalMessage,
            EVAL_EXIT_CODE: String(input.exitCode),
          },
          signal,
          context,
        });
      } catch (e) {
        error = e as Error;
        if (e instanceof RuntimeExecutionError) result = e.result;
      }
      const evidence = result.stdout.trim(),
        debug = result.stderr.trim();
      if (error) {
        if (signal?.aborted && signal.reason?.name === "TimeoutError") {
          const detail = `script timed out after ${timeoutMs / 1000}s`;
          if (this.timeoutIsError) {
            const error = new Error(detail, { cause: signal.reason });
            throw new JudgeEvaluationError(
              error,
              newErrorResult(error, input.turnsExecuted, input.turnsTotal),
            );
          }
          return this.buildResult(false, detail, debug, input);
        }
        if (result.exitCode === 0)
          throw new Error(`script execution failed: ${error.message}`, {
            cause: error,
          });
      }
      return result.exitCode !== 0
        ? this.buildResult(
            false,
            evidence || `script exited with code ${result.exitCode}`,
            debug,
            input,
          )
        : this.buildResult(
            true,
            evidence || "script passed (exit code 0)",
            debug,
            input,
          );
    } finally {
      try {
        await rt.exec(plan.cleanupCommand(dir), { context });
      } catch {}
    }
  }
  buildResult(
    passed: boolean,
    evidence: string,
    debugInfo: string,
    input: Input,
  ): Result {
    const i = resolveInput(input);
    return newResult(
      [
        {
          text: "script: " + this.scriptPath,
          passed,
          evidence:
            evidence + (debugInfo ? " [stderr: " + debugInfo + "]" : ""),
        },
      ],
      i.turnsExecuted,
      i.turnsTotal,
    );
  }
}
