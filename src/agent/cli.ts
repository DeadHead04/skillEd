// Modified for the skilled TypeScript distribution.
import path from "node:path";
import { isExactVersion } from "../contracts/agentkind.js";
import { context } from "@opentelemetry/api";
import { contextWithConfiguredAgentSpanAttributes } from "../observability/index.js";
import {
  BaseAgent,
  requireBashTargetShell,
  buildInstructionFromMessages,
  shellQuote,
} from "./base.js";
import { AgentExecutionError, errAgentNotFound } from "./errors.js";
import { RuntimeExecutionError } from "../runtime/types.js";
import type {
  Runtime,
  ExecOptions,
  MCPConfig,
  SkillConfig,
  SessionResult,
  RuntimeObservation,
} from "./types.js";
import type { Message } from "../contracts/transcript.js";
import { goPrintf, renderGoTemplate } from "./go-template.js";
export class CLIAgent extends BaseAgent {
  protected requireShell(rt: Runtime): void {
    try {
      requireBashTargetShell(rt);
    } catch (e) {
      throw new Error(`${this.name()}: ${(e as Error).message}`, { cause: e });
    }
  }
  async installMCP(
    rt: Runtime,
    cfg: MCPConfig,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.cfg.installMCPCmd) {
      if (cfg.servers.length)
        throw new Error(
          `agent ${this.name()} does not support MCP installation: InstallMCPCmd is not configured`,
        );
      return;
    }
    for (const s of cfg.servers) {
      const cmd = renderGoTemplate(this.cfg.installMCPCmd, {
        Name: s.name,
        Transport: s.transport ?? "",
        Command: s.command ?? "",
        Args: s.args ?? [],
        Endpoint: s.endpoint ?? "",
        ConfigRef: s.configRef ?? "",
        Workspace: rt.workspace(),
        Env: s.env ?? {},
        Headers: s.headers ?? {},
      });
      const r = await rt.exec(cmd, { env: s.env, signal });
      if (r.exitCode !== 0)
        throw new Error(
          `MCP server ${s.name} installation failed: ${r.stderr}`,
        );
    }
  }
  async installSkill(
    rt: Runtime,
    cfg: SkillConfig,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.cfg.installSkillCmd)
      return this.installSkillDefault(rt, cfg, signal);
    if (cfg.include?.length || cfg.exclude?.length)
      throw new Error(
        "skill include/exclude filters are not supported with a custom InstallSkillCmd",
      );
    const cmd = renderGoTemplate(this.cfg.installSkillCmd, {
      Source: cfg.source,
      Target:
        cfg.target ||
        path.join(rt.workspace(), "skills", path.basename(cfg.source)),
      Workspace: rt.workspace(),
    });
    const r = await rt.exec(cmd, { signal });
    if (r.exitCode !== 0)
      throw new Error(`skill installation failed: ${r.stderr}`);
  }
  async run(
    rt: Runtime,
    opts: ExecOptions,
    messages: Message[],
  ): Promise<SessionResult> {
    this.requireShell(rt);
    const start = Date.now();
    const command = goSprintfOne(
      this.cfg.runCmd,
      shellQuote(buildInstructionFromMessages(messages)),
    );
    opts = this.mergeExecOptionsEnv(
      opts,
      this.credentialEnvVars("", ""),
      this.buildAgentObservabilityAttrs(),
    );
    opts.context = contextWithConfiguredAgentSpanAttributes(
      opts.context ?? context.active(),
      opts.env ?? {},
    );
    let r, error: unknown;
    try {
      r = await rt.exec(command, opts);
    } catch (e) {
      error = e;
      r =
        e instanceof RuntimeExecutionError
          ? e.result
          : { stdout: "", stderr: "", exitCode: 1 };
    }
    const result: SessionResult = {
      engine: this.name(),
      exit_code: r.exitCode,
      duration_ms: Date.now() - start,
      turns: 0,
      final_message: r.stdout,
      stderr: r.stderr,
      artifacts: {},
    };
    this.annotateSessionResult(result);
    if (error) {
      result.exit_code ||= 1;
      throw new AgentExecutionError(
        `agent run failed: ${String(error)}`,
        result,
        { cause: error },
      );
    }
    if (r.exitCode !== 0)
      throw new AgentExecutionError(
        `agent run failed (exit ${r.exitCode}): ${r.stderr}`,
        result,
      );
    return result;
  }
  async check(rt: Runtime, signal?: AbortSignal): Promise<void> {
    this.requireShell(rt);
    if (!this.cfg.checkCmd)
      throw new Error(`CheckCmd not configured for agent ${this.name()}`);
    let r;
    try {
      r = await rt.exec(
        checkCommandForOS(this.cfg.checkCmd, rt.shell().goos),
        this.mergeExecOptionsEnv({ signal }, {}, {}),
      );
    } catch (e) {
      throw new Error("check failed: " + (e as Error).message, { cause: e });
    }
    if (r.exitCode !== 0)
      throw new Error(`${errAgentNotFound.message}: ${this.name()} not found`, {
        cause: errAgentNotFound,
      });
  }
  async inspectRuntime(
    rt: Runtime,
    signal?: AbortSignal,
  ): Promise<RuntimeObservation> {
    if (!this.cfg.versionCmd) return { version: "" };
    let r;
    try {
      r = await rt.exec(
        checkCommandForOS(this.cfg.versionCmd, rt.shell().goos),
        this.mergeExecOptionsEnv({ signal }, {}, {}),
      );
    } catch (e) {
      throw new Error("version check failed: " + (e as Error).message, {
        cause: e,
      });
    }
    if (r.exitCode !== 0)
      throw new Error(
        `version check failed for ${this.name()} (exit ${r.exitCode}): ${r.stderr}`,
      );
    const detected = normalizeVersionOutput(r.stdout + "\n" + r.stderr),
      expected = normalizedConfiguredVersion(this.cfg.version);
    if (!detected && expected)
      throw new Error(`version check for ${this.name()} returned no version`);
    if (expected && detected !== expected)
      throw new Error(
        `agent ${this.name()} version mismatch: found ${detected}, want ${expected}`,
      );
    return { version: detected };
  }
}
export function checkCommandForOS(command: string, goos: string): string {
  if (goos !== "windows") return command;
  const m = /^\s*command\s+-v\s+(\S+)(\s.*)?$/.exec(command);
  return m
    ? "where " + m[1] + (m[2] ?? "").replaceAll("/dev/null", "nul")
    : command;
}
const versionPattern =
  /(?:^|[^0-9A-Za-z.+-])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?:$|[^0-9A-Za-z.+-])/;
export function normalizeVersionOutput(output: string): string {
  const v = versionPattern.exec(output)?.[1] ?? "";
  return isExactVersion(v) ? v : "";
}
export function normalizedConfiguredVersion(version: string): string {
  return isExactVersion(version) ? version.trim().replace(/^v/, "") : "";
}
const goSprintfOne = (format: string, arg: string): string =>
  goPrintf(format, arg);
