// Modified for the skilled TypeScript distribution.
import path from "node:path";
import type { CustomAgent, CustomRunPrep, TransportOutcome } from "./custom.js";
import { usableSessionResult } from "./custom.js";
import type { Runtime, ExecOptions } from "./types.js";
import type { CustomEngineConfig } from "../contracts/schema.js";
import { persistRuntimeArtifact } from "./base.js";
import { RuntimeExecutionError } from "../runtime/types.js";
import {
  renderTemplate,
  workspacePath,
  combinedSignal,
  isDeadlineError,
  customArtifactReadTimeoutMs,
  customDefaultInputFile,
  customDefaultOutputFile,
} from "./custom-support.js";
export async function resolveCustomIOFiles(
  rt: Runtime,
  custom: CustomEngineConfig,
  vars: Record<string, string>,
): Promise<{ inputFile: string; outputFile: string }> {
  const local = custom.local!;
  const resolve = async (value: string, fallback: string, label: string) => {
    if (!value) return path.join(rt.workspace(), fallback);
    let rendered: string;
    try {
      rendered = renderTemplate(value, vars);
    } catch (e) {
      throw new Error(`render local.${label}: ${(e as Error).message}`, {
        cause: e,
      });
    }
    try {
      return await workspacePath(rt, rendered);
    } catch (e) {
      throw new Error(`local.${label}: ${(e as Error).message}`, { cause: e });
    }
  };
  return {
    inputFile: await resolve(
      local.input_file,
      customDefaultInputFile,
      "input_file",
    ),
    outputFile: await resolve(
      local.output_file,
      customDefaultOutputFile,
      "output_file",
    ),
  };
}
export async function runLocalTransport(
  a: CustomAgent,
  rt: Runtime,
  opts: ExecOptions,
  prep: CustomRunPrep,
): Promise<TransportOutcome> {
  const custom = prep.custom;
  if (!custom.local)
    throw new Error(
      "engine.custom.local.command is required when transport is local",
    );
  const { inputFile, outputFile } = await resolveCustomIOFiles(
    rt,
    custom,
    prep.vars,
  );
  prep.vars.input_file = inputFile;
  prep.vars.output_file = outputFile;
  try {
    await persistRuntimeArtifact(rt, inputFile, prep.sessJSON, opts.signal);
  } catch (e) {
    throw new Error(`write session input: ${(e as Error).message}`, {
      cause: e,
    });
  }
  const cleared =
    !!custom.local.output_file &&
    path.normalize(inputFile) !== path.normalize(outputFile) &&
    (await a.clearStaleOutputFile(rt, outputFile, opts.signal));
  const { command, options } = await a.buildLocalExec(
    rt,
    opts,
    custom,
    prep.vars,
    prep.timeoutSec,
  );
  const signal = combinedSignal(opts.signal, prep.timeoutSec * 1000);
  let result = { stdout: "", stderr: "", exitCode: 0 },
    execErr: Error | undefined;
  try {
    result = await rt.exec(command, { ...options, signal });
  } catch (e) {
    execErr = e as Error;
    if (e instanceof RuntimeExecutionError) result = e.result;
  }
  const readSignal = execErr
    ? AbortSignal.timeout(customArtifactReadTimeoutMs)
    : opts.signal;
  let { raw, produced } = await a.readRawResult(
    rt,
    custom,
    result.stdout,
    outputFile,
    readSignal,
  );
  if (
    execErr &&
    !produced &&
    outputFile &&
    custom.local.output_file &&
    custom.response_format !== "text" &&
    (isDeadlineError(execErr) || signal?.reason?.name === "TimeoutError") &&
    !usableSessionResult(raw)
  )
    raw = await a.synthesizeTimeoutOutput(opts.artifactDir, prep);
  const frameworkFiles = [inputFile];
  if ((produced || cleared) && outputFile) frameworkFiles.push(outputFile);
  return {
    raw,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    execErr,
    frameworkFiles,
  };
}
