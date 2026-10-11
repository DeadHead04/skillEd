// Modified for the skilled TypeScript distribution.
import { AgentExecutionError } from "./errors.js";
import { CLIAgent } from "./cli.js";
import {
  parseStreamOutput,
  parseSessionFile,
  countTurns,
} from "./claude-code.js";
import {
  requireBashTargetShell,
  buildInstructionFromMessages,
  shellQuote,
  persistSessionArtifact,
} from "./base.js";
import { deliverPrompt } from "./prompt-delivery.js";
import {
  installMCPServers,
  buildClaudeCompatibleMCPInstallCmd,
} from "./mcp.js";
import {
  findAgentSessionJSONL,
  extractSessionIDFromPath,
  withDownloadedSession,
  sessionCleanupOptions,
} from "./session-lookup.js";
import { warnf, debugf } from "../logging/index.js";
import { contextWithConfiguredAgentSpanAttributes } from "../observability/index.js";
import { ROOT_CONTEXT } from "@opentelemetry/api";
import type {
  Config,
  Runtime,
  ExecOptions,
  ExecResult,
  SessionResult,
  MCPConfig,
} from "./types.js";
import type { MCPServerConfig } from "../runtime/types.js";
import { RuntimeExecutionError } from "../runtime/types.js";
import type { Message } from "../contracts/transcript.js";
export interface QoderCLIProfile {
  edition: string;
  binary: string;
  credentialEnv: string;
  exposeUsageEnv: string;
  configDir: string;
  installURL: string;
  execPathProbe: string;
}
export const qoderExecPathProbeCmd = `printf '%s' "$HOME/.local/bin:$PATH"`,
  qoderCNExecPathProbeCmd = `printf '%s' "$HOME/.qoder-cn/entry:$HOME/.local/bin:$PATH"`;
export function qoderProfileForKwargs(
  kwargs: Record<string, string> = {},
): QoderCLIProfile {
  const edition = (kwargs.edition ?? "").trim().toLowerCase();
  if (edition === "cn")
    return {
      edition: "cn",
      binary: "qodercn",
      credentialEnv: "QODERCN_PERSONAL_ACCESS_TOKEN",
      exposeUsageEnv: "QODERCN_EXPOSE_TOKEN_USAGE",
      configDir: ".qoder-cn",
      installURL: "https://static.qoder.com.cn/qoder-cli-cn/install.sh",
      execPathProbe: qoderCNExecPathProbeCmd,
    };
  if (edition && edition !== "global")
    warnf("qodercli ignores unsupported edition %s and uses global", edition);
  return {
    edition: "global",
    binary: "qodercli",
    credentialEnv: "QODER_PERSONAL_ACCESS_TOKEN",
    exposeUsageEnv: "QODER_EXPOSE_TOKEN_USAGE",
    configDir: ".qoder",
    installURL: "https://qoder.com/install",
    execPathProbe: qoderExecPathProbeCmd,
  };
}
export const qoderCLIInvocation = (binary: string): string =>
  "env -u QODER_AGENT_SDK_ENTRYPOINT " + binary;
export function buildQoderRunCmdForBinary(
  binary: string,
  instruction: string,
  model: string,
): string {
  return (
    qoderCLIInvocation(binary) +
    " --permission-mode=bypass_permissions --output-format json" +
    (model ? " --model " + shellQuote(model) : "") +
    " -p " +
    shellQuote(instruction)
  );
}
export const buildQoderRunCmd = (instruction: string, model: string): string =>
  buildQoderRunCmdForBinary("qodercli", instruction, model);
export function buildQoderRunStdinCmdForBinary(
  binary: string,
  promptPath: string,
  model: string,
): string {
  return (
    "cat " +
    shellQuote(promptPath) +
    " | " +
    qoderCLIInvocation(binary) +
    " --permission-mode=bypass_permissions --output-format json" +
    (model ? " --model " + shellQuote(model) : "") +
    " -p -"
  );
}
export function buildQoderResumeCmdForBinary(
  binary: string,
  instruction: string,
  model: string,
  sessionID: string,
): string {
  return (
    qoderCLIInvocation(binary) +
    " --permission-mode=bypass_permissions --output-format json" +
    (model ? " --model " + shellQuote(model) : "") +
    " -r " +
    shellQuote(sessionID) +
    " -p " +
    shellQuote(instruction)
  );
}
export const buildQoderResumeCmd = (
  instruction: string,
  model: string,
  sessionID: string,
): string =>
  buildQoderResumeCmdForBinary("qodercli", instruction, model, sessionID);
export const buildQoderMCPInstallCmdForBinary = (
  binary: string,
  server: MCPServerConfig,
): string =>
  buildClaudeCompatibleMCPInstallCmd(
    qoderCLIInvocation(binary),
    binary,
    server,
  );
export const buildQoderMCPInstallCmd = (server: MCPServerConfig): string =>
  buildQoderMCPInstallCmdForBinary("qodercli", server);
export const defaultQoderCLIInstallCmdForProfile = (
  p: QoderCLIProfile,
): string =>
  [
    "set -e",
    "if command -v " + p.binary + " >/dev/null 2>&1; then exit 0; fi",
    "curl -fsSL " + p.installURL + " | bash",
  ].join("\n");
export const defaultQoderCLIInstallCmd = (): string =>
  defaultQoderCLIInstallCmdForProfile(qoderProfileForKwargs());
export function parseQoderSessionID(output: string): string {
  try {
    const e = JSON.parse(output.trim());
    return typeof e?.session_id === "string" ? e.session_id : "";
  } catch {
    return "";
  }
}
export const findQoderSessionFileInConfigDir = (
  rt: Runtime,
  configDir: string,
  opts: ExecOptions = {},
): Promise<string> =>
  findAgentSessionJSONL(
    rt,
    {
      projectsRootTmpl: "$home/" + configDir + "/projects",
      sessionDepth: 1,
      findExtra: '! -name "*-session.json"',
    },
    opts,
  );
export const findQoderSessionFile = (
  rt: Runtime,
  opts: ExecOptions = {},
): Promise<string> => findQoderSessionFileInConfigDir(rt, ".qoder", opts);
export class QoderCLIAgent extends CLIAgent {
  readonly profile: QoderCLIProfile;
  constructor(cfg: Config) {
    const profile = qoderProfileForKwargs(cfg.kwargs);
    super({
      ...cfg,
      version: "",
      name: cfg.name || "qodercli",
      checkCmd: cfg.checkCmd || "command -v " + profile.binary,
      versionCmd:
        cfg.versionCmd || qoderCLIInvocation(profile.binary) + " --version",
      runCmd:
        cfg.runCmd || qoderCLIInvocation(profile.binary) + ' -p "%s" 2>&1',
      skillPath: cfg.skillPath || ".qoder/skills",
    });
    this.profile = profile;
  }
  async checkCredentials(): Promise<void> {
    if (this.cfg.envVars[this.profile.credentialEnv])
      debugf(
        "%s detected for %s (source=runtime_env)",
        this.profile.credentialEnv,
        this.profile.binary,
      );
    else if (process.env[this.profile.credentialEnv])
      debugf(
        "%s detected for %s (source=process_env)",
        this.profile.credentialEnv,
        this.profile.binary,
      );
    else
      warnf(
        "%s not set, %s will rely on existing login state if available",
        this.profile.credentialEnv,
        this.profile.binary,
      );
  }
  appliedModelName(): string {
    return this.cfg.modelName.trim();
  }
  modelErrorContext(): string {
    return this.appliedModelName()
      ? " with model " + JSON.stringify(this.appliedModelName())
      : "";
  }
  qoderRunEnvVars(): Record<string, string> {
    const env = this.credentialEnvVars("", "");
    if (!Object.hasOwn(env, this.profile.exposeUsageEnv))
      env[this.profile.exposeUsageEnv] = "true";
    return env;
  }
  async install(rt: Runtime, signal?: AbortSignal): Promise<void> {
    await this.probeAndMergePATH(rt, this.profile.execPathProbe, signal);
    const opts = this.mergeExecOptionsEnv({ cwd: "/", signal }, {}, {});
    const result = await rt.exec(
      this.cfg.installCmd || defaultQoderCLIInstallCmdForProfile(this.profile),
      opts,
    );
    if (result.exitCode !== 0)
      throw new Error("install failed: agent install failed: " + result.stderr);
  }
  async installMCP(
    rt: Runtime,
    config: MCPConfig,
    signal?: AbortSignal,
  ): Promise<void> {
    await installMCPServers(
      rt,
      config,
      (s) => buildQoderMCPInstallCmdForBinary(this.profile.binary, s),
      signal,
    );
  }
  async run(
    rt: Runtime,
    opts: ExecOptions,
    messages: Message[],
  ): Promise<SessionResult> {
    requireBashTargetShell(rt);
    const start = performance.now(),
      instruction = buildInstructionFromMessages(messages);
    let delivery;
    try {
      delivery = await deliverPrompt(rt, opts, instruction, {
        inline: (p) =>
          buildQoderRunCmdForBinary(
            this.profile.binary,
            p,
            this.appliedModelName(),
          ),
        stdinFile: (p) =>
          buildQoderRunStdinCmdForBinary(
            this.profile.binary,
            p,
            this.appliedModelName(),
          ),
      });
    } catch (e) {
      const sessionResult = {
        engine: this.name(),
        exit_code: 1,
        duration_ms: Math.floor(performance.now() - start),
        turns: 0,
        artifacts: {},
      };
      this.annotateSessionResult(sessionResult);
      throw new AgentExecutionError(String(e), sessionResult, { cause: e });
    }
    try {
      const result = await this.executeAndBuild(
        rt,
        opts,
        instruction,
        start,
        delivery.command,
        "run",
        "",
      );
      result.prompt_delivery = delivery.metadata;
      return result;
    } catch (error) {
      if (error instanceof AgentExecutionError)
        error.result.prompt_delivery = delivery.metadata;
      throw error;
    }
  }
  async runTurn(
    rt: Runtime,
    opts: ExecOptions,
    message: Message,
    sessionID: string,
  ): Promise<SessionResult> {
    if (!sessionID) return this.run(rt, opts, [message]);
    requireBashTargetShell(rt);
    const instruction = message.content ?? "",
      start = performance.now();
    return this.executeAndBuild(
      rt,
      opts,
      instruction,
      start,
      buildQoderResumeCmdForBinary(
        this.profile.binary,
        instruction,
        this.appliedModelName(),
        sessionID,
      ),
      "resume",
      sessionID,
    );
  }
  private async executeAndBuild(
    rt: Runtime,
    opts: ExecOptions,
    instruction: string,
    start: number,
    command: string,
    mode: string,
    sessionID: string,
  ): Promise<SessionResult> {
    opts = this.mergeExecOptionsEnv(
      opts,
      this.qoderRunEnvVars(),
      this.buildAgentObservabilityAttrs(),
    );
    opts.context = contextWithConfiguredAgentSpanAttributes(
      opts.context ?? ROOT_CONTEXT,
      opts.env ?? {},
    );
    let execution: ExecResult, error: unknown;
    try {
      execution = await rt.exec(command, opts);
    } catch (e) {
      error = e;
      execution =
        e instanceof RuntimeExecutionError
          ? e.result
          : { stdout: "", stderr: "", exitCode: 1 };
    }
    const result = await this.buildSessionResult(
      rt,
      opts,
      instruction,
      start,
      execution,
    );
    if (sessionID) result.session_id = sessionID;
    this.annotateSessionResult(result);
    if (error || execution.exitCode !== 0)
      throw new AgentExecutionError(
        error
          ? `${this.profile.binary} ${mode} failed${this.modelErrorContext()}: ${String(error)}`
          : `${this.profile.binary} ${mode} failed${this.modelErrorContext()} (exit ${execution.exitCode}): ${execution.stderr}`,
        result,
        { cause: error },
      );
    return result;
  }
  async buildSessionResult(
    rt: Runtime,
    opts: ExecOptions,
    instruction: string,
    start: number,
    execution: ExecResult,
  ): Promise<SessionResult> {
    let parsed = parseStreamOutput(execution.stdout),
      sessionID = parseQoderSessionID(execution.stdout),
      files: string[] = [];
    const cleanupOpts = sessionCleanupOptions(opts);
    try {
      const artifact = await persistSessionArtifact(
        rt,
        opts.artifactDir ?? "",
        "stdout.json",
        execution.stdout,
        cleanupOpts.signal,
      );
      if (!opts.artifactDir) files.push(artifact);
    } catch {}
    const sessionFile = await findQoderSessionFileInConfigDir(
      rt,
      this.profile.configDir,
      cleanupOpts,
    );
    if (!sessionID && sessionFile)
      sessionID = extractSessionIDFromPath(sessionFile);
    const download = await withDownloadedSession(
      rt,
      opts.artifactDir ?? "",
      sessionFile,
      files,
      async (artifact) => {
        const p = await parseSessionFile(artifact);
        if (p.transcript.length) {
          parsed.transcript = p.transcript;
          if (p.finalMsg) parsed.finalMsg = p.finalMsg;
        }
        parsed.inputTokens = Math.max(parsed.inputTokens, p.inputTokens);
        parsed.outputTokens = Math.max(parsed.outputTokens, p.outputTokens);
      },
      cleanupOpts,
    );
    try {
      files = download.files;
      if (!parsed.transcript.length) {
        const assistant = parsed.finalMsg || execution.stdout.trim();
        if (assistant) {
          parsed.transcript = [
            { role: "user", content: instruction, turn: 1 },
            { role: "assistant", content: assistant, turn: 1 },
          ];
          parsed.finalMsg = assistant;
        }
      }
      return {
        engine: this.name(),
        session_id: sessionID,
        exit_code: execution.exitCode,
        duration_ms: Math.floor(performance.now() - start),
        turns: countTurns(parsed.transcript),
        input_tokens: parsed.inputTokens,
        output_tokens: parsed.outputTokens,
        final_message: parsed.finalMsg,
        stderr: execution.stderr,
        transcript: parsed.transcript,
        artifacts: { generated_files: files },
      };
    } finally {
      await download.cleanup();
    }
  }
}
