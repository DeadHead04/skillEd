// Modified for the skilled TypeScript distribution.
import { normalizeSessionResult } from "./types.js";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { context } from "@opentelemetry/api";
import { validateShell, isBash, quotePOSIX } from "../platform/index.js";
import { agentEnv } from "../observability/index.js";
import { debugf, warnf } from "../logging/index.js";
import { maskAPIKey } from "../credentials/index.js";
import { isExactVersion } from "../contracts/agentkind.js";
import { installSkill } from "./skill.js";
import { errAgentRequiresBash } from "./errors.js";
import type {
  AgentConfig,
  NormalizedAgentConfig,
  Agent,
  RuntimeInspector,
  RuntimeObservation,
  Runtime,
  ExecOptions,
  SkillConfig,
  SessionResult,
} from "./types.js";
import type { Message } from "../contracts/transcript.js";
export function requireBashTargetShell(rt: Runtime): void {
  const shell = rt.shell();
  try {
    validateShell(shell);
  } catch (e) {
    throw new Error(`invalid runtime shell: ${(e as Error).message}`, {
      cause: e,
    });
  }
  if (shell.goos === "windows" && !isBash(shell)) throw errAgentRequiresBash;
}
export async function preflight(
  rt: Runtime,
  agent: Agent,
  signal?: AbortSignal,
): Promise<RuntimeObservation> {
  await agent.check(rt, signal);
  return "inspectRuntime" in agent
    ? await (agent as Agent & RuntimeInspector).inspectRuntime(rt, signal)
    : { version: "" };
}
export class BaseAgent {
  cfg: NormalizedAgentConfig;
  version: string;
  constructor(cfg: AgentConfig) {
    this.cfg = {
      version: "",
      installCmd: "",
      runCmd: "",
      versionCmd: "",
      checkCmd: "",
      installMCPCmd: "",
      installSkillCmd: "",
      envVars: {},
      skillPath: "",
      modelName: "",
      requestedModelName: "",
      requestedProvider: "",
      modelProvider: "",
      protocol: "",
      warnings: [],
      apiKey: "",
      baseURL: "",
      kwargs: {},
      custom: null,
      ...cfg,
    };
    this.cfg.envVars ??= {};
    this.cfg.warnings = [...(cfg.warnings ?? [])];
    this.version = this.cfg.version;
  }
  name(): string {
    return this.cfg.name;
  }
  skillPath(): string {
    return this.cfg.skillPath;
  }
  async checkCredentials(_signal?: AbortSignal): Promise<void> {
    const provider = this.cfg.requestedProvider || this.cfg.modelProvider;
    if (provider === "openai")
      this.logCredentialStatus(
        "OPENAI_API_KEY",
        "OPENAI_BASE_URL",
        "OPENAI_API_KEY not set, agent will rely on existing login state if available",
      );
    if (provider === "anthropic")
      this.logCredentialStatus(
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_API_KEY not set, agent will rely on existing login state if available",
      );
  }
  logCredentialStatus(
    apiKeyEnv: string,
    baseURLEnv: string,
    missing: string,
  ): void {
    if (this.cfg.apiKey) {
      debugf(
        "%s detected for %s (masked: %s, source=agent_config)",
        apiKeyEnv,
        this.name(),
        maskAPIKey(this.cfg.apiKey),
      );
      if (baseURLEnv && this.cfg.baseURL)
        debugf(
          "%s detected for %s (value: %s, source=agent_config)",
          baseURLEnv,
          this.name(),
          this.cfg.baseURL,
        );
      return;
    }
    if (process.env[apiKeyEnv]) {
      debugf("%s detected for %s (source=process_env)", apiKeyEnv, this.name());
      if (baseURLEnv && process.env[baseURLEnv])
        debugf(
          "%s detected for %s (source=process_env)",
          baseURLEnv,
          this.name(),
        );
      return;
    }
    warnf("%s", missing);
  }
  credentialEnvVars(
    apiKeyEnv: string,
    baseURLEnv: string,
  ): Record<string, string> {
    const env = { ...this.cfg.envVars };
    if (this.cfg.apiKey && apiKeyEnv) env[apiKeyEnv] = this.cfg.apiKey;
    if (this.cfg.baseURL && baseURLEnv) env[baseURLEnv] = this.cfg.baseURL;
    return env;
  }
  async installSkillDefault(
    rt: Runtime,
    cfg: SkillConfig,
    signal?: AbortSignal,
  ): Promise<void> {
    const target =
      cfg.target ||
      (this.cfg.skillPath
        ? path.join(this.cfg.skillPath, path.basename(cfg.source))
        : "");
    await installSkill(
      rt,
      cfg.source,
      target,
      cfg.include ?? [],
      cfg.exclude ?? [],
      signal,
    );
  }
  mergeExecOptionsEnv(
    opts: ExecOptions,
    envVars: Record<string, string>,
    attrs: Record<string, string> = {},
  ): ExecOptions {
    const merged = { ...envVars, ...opts.env };
    return {
      ...opts,
      env: {
        ...merged,
        ...agentEnv(opts.context ?? context.active(), merged, attrs),
      },
    };
  }
  async probeAndMergePATH(
    rt: Runtime,
    probeCmd: string,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      const result = await rt.exec(probeCmd, { signal });
      if (result.exitCode !== 0) {
        warnf(
          "agent %s: PATH probe failed (exit=%d); using runtime default PATH",
          this.name(),
          result.exitCode,
        );
        return;
      }
      const resolved = result.stdout.trim();
      if (resolved) rt.mergeEnv({ PATH: resolved });
    } catch (e) {
      warnf(
        "agent %s: PATH probe failed (%s); using runtime default PATH",
        this.name(),
        String(e),
      );
    }
  }
  buildAgentObservabilityAttrs(
    extra: Record<string, string> = {},
  ): Record<string, string> {
    const attrs = { ...extra };
    const cfg = this.cfg;
    if (this.name()) attrs["skilled.engine"] = this.name();
    if (cfg.protocol) attrs["skilled.protocol.applied"] = cfg.protocol;
    if (cfg.modelProvider)
      attrs["skilled.provider.applied"] = cfg.modelProvider;
    if (cfg.requestedProvider)
      attrs["skilled.provider.requested"] = cfg.requestedProvider;
    if (cfg.modelName) {
      attrs["skilled.model"] = formatAgentModel(
        cfg.modelProvider,
        cfg.modelName,
      );
      attrs["skilled.model.applied"] = attrs["skilled.model"];
    }
    if (cfg.requestedModelName)
      attrs["skilled.model.requested"] = formatAgentModel(
        cfg.requestedProvider,
        cfg.requestedModelName,
      );
    return attrs;
  }
  annotateSessionResult(result: SessionResult | null | undefined): void {
    if (!result) return;
    result.engine ||= this.name();
    for (const [key, value] of Object.entries({
      applied_protocol: this.cfg.protocol,
      requested_provider: this.cfg.requestedProvider,
      applied_provider: this.cfg.modelProvider,
      requested_model: this.cfg.requestedModelName,
      applied_model: this.cfg.modelName,
    })) {
      if (value) (result as unknown as Record<string, unknown>)[key] = value;
      else delete (result as unknown as Record<string, unknown>)[key];
    }
    for (const warning of this.cfg.warnings)
      if (!result.warnings?.includes(warning))
        (result.warnings ??= []).push(warning);
    normalizeSessionResult(result);
  }
}
export async function persistRuntimeArtifact(
  rt: Runtime,
  targetPath: string,
  content: string,
  signal?: AbortSignal,
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skilled-artifact-"));
  try {
    const file = path.join(dir, "artifact");
    await writeFile(file, content, { mode: 0o600 });
    await rt.uploadFile(file, targetPath, signal);
  } catch (e) {
    throw new Error(`upload ${targetPath}: ${(e as Error).message}`, {
      cause: e,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function writeLocalArtifact(
  artifactDir: string,
  fileName: string,
  content: string | Uint8Array,
): Promise<string> {
  const target = path.join(artifactDir, path.basename(fileName));
  await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
  await writeFile(target, content, { mode: 0o600 });
  return target;
}
export async function persistSessionArtifact(
  rt: Runtime,
  artifactDir: string | undefined,
  targetPath: string,
  content: string,
  signal?: AbortSignal,
): Promise<string> {
  if (artifactDir)
    return writeLocalArtifact(artifactDir, path.basename(targetPath), content);
  await persistRuntimeArtifact(rt, targetPath, content, signal);
  return targetPath;
}
export async function downloadSessionArtifact(
  rt: Runtime,
  artifactDir: string | undefined,
  sessionFilePath: string,
  signal?: AbortSignal,
): Promise<{
  artifactPath: string;
  registeredPath: string;
  cleanup: () => Promise<void>;
  ok: boolean;
}> {
  let cleanup = async () => {};
  let target = "";
  try {
    const dir =
      artifactDir ||
      (await mkdtemp(path.join(os.tmpdir(), "skilled-session-")));
    if (!artifactDir)
      cleanup = async () => {
        await rm(dir, { recursive: true, force: true });
      };
    target = path.join(dir, path.basename(sessionFilePath));
    await rt.downloadFile(sessionFilePath, target, signal);
    return {
      artifactPath: target,
      registeredPath: artifactDir ? "" : sessionFilePath,
      cleanup,
      ok: true,
    };
  } catch {
    await cleanup();
    return { artifactPath: "", registeredPath: "", cleanup, ok: false };
  }
}
export function formatAgentModel(provider: string, model: string): string {
  return provider ? (model ? provider + "/" + model : provider) : model;
}
export function versionedPackage(packageName: string, version: string): string {
  return version.trim() ? packageName + "@" + version.trim() : packageName;
}
export function installedVersionGuard(binary: string, version: string): string {
  const expected = isExactVersion(version)
    ? version.trim().replace(/^v/, "")
    : "";
  if (!expected) return "";
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `if command -v ${binary} >/dev/null 2>&1 && ${binary} --version 2>&1 | grep -Eq ${shellQuote("(^|[^0-9A-Za-z])v?" + escaped + "([^0-9A-Za-z.+-]|$)")}; then exit 0; fi`;
}
export const shellQuote = quotePOSIX;
export function buildInstructionFromMessages(messages: Message[]): string {
  return messages
    .filter((m) => m.role === "user")
    .map((m) => (m.content ?? "") + "\n\n")
    .join("")
    .trim();
}
