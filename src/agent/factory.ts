// Modified for the skilled TypeScript distribution.
import { supportsVersion, isExactVersion } from "../contracts/agentkind.js";
import type { ResolvedAgentConfig } from "../credentials/index.js";
import { debugf } from "../logging/index.js";
import type { Agent, AgentConfig } from "./types.js";
import { UnsupportedAgentError } from "./errors.js";
import { CustomAgent, StatefulCustomAgent } from "./custom.js";
import { ClaudeCodeAgent } from "./claude-code.js";
import { CodexAgent } from "./codex.js";
import { OpenCodeAgent } from "./opencode.js";
import { QoderCLIAgent, qoderProfileForKwargs } from "./qodercli.js";
import { QwenCodeAgent } from "./qwen-code.js";
import { logUnknownEngineKwargs } from "./kwargs.js";

export function detectAgent(engineName: string, config: AgentConfig): Agent {
  const cfg = {
    ...config,
    name: config.name || engineName,
    warnings: [...(config.warnings || [])],
  };
  let warning = "";
  if (cfg.version && !supportsVersion(engineName))
    warning = `engine ${JSON.stringify(engineName)} does not support engine.version; the configured version ${JSON.stringify(cfg.version)} is ignored`;
  else if (cfg.version && !isExactVersion(cfg.version))
    warning = `engine ${JSON.stringify(engineName)} requires an exact semantic version for version selection; the configured version ${JSON.stringify(cfg.version)} is ignored`;
  if (warning) {
    if (!cfg.warnings.includes(warning)) cfg.warnings.push(warning);
    cfg.version = "";
  }
  switch (engineName) {
    case "qodercli":
    case "qoder":
    case "qoder-cli":
      return new QoderCLIAgent(cfg);
    case "claude_code":
    case "claude-code":
      return new ClaudeCodeAgent(cfg);
    case "codex":
      return new CodexAgent(cfg);
    case "opencode":
      return new OpenCodeAgent(cfg);
    case "qwen_code":
    case "qwen-code":
    case "qwen":
      return new QwenCodeAgent(cfg);
    default:
      if (cfg.custom)
        return cfg.custom.conversation_mode === "stateful"
          ? new StatefulCustomAgent(cfg)
          : new CustomAgent(cfg);
      throw new UnsupportedAgentError(engineName);
  }
}

export function detectAgentWithResolvedConfig(
  params: ResolvedAgentConfig,
): Agent {
  const connection = params.appliedConnection;
  if (!connection?.protocol)
    throw new Error(
      `agent config for engine ${JSON.stringify(params.engine)} was not materialized`,
    );
  const cfg: AgentConfig = {
    name: params.engine,
    version: params.appliedVersion,
    modelName: params.appliedModel,
    requestedModelName: params.model,
    requestedProvider: params.provider,
    modelProvider: connection.provider,
    protocol: connection.protocol,
    warnings: params.warnings,
    apiKey: connection.apiKey,
    baseURL: connection.baseURL,
    envVars: {},
    kwargs: params.kwargs,
    custom: params.custom,
  };
  logUnknownEngineKwargs(params.engine, params.kwargs);
  if (["qodercli", "qoder", "qoder-cli"].includes(params.engine)) {
    const profile = qoderProfileForKwargs(params.kwargs);
    let sourceEnv = profile.credentialEnv;
    let token = process.env[sourceEnv];
    if (!token && profile.edition === "cn") {
      sourceEnv = "QODER_CN_ACCESS_TOKEN";
      token = process.env[sourceEnv];
    }
    if (token) {
      cfg.envVars![profile.credentialEnv] = token;
      debugf(
        "AGENT_CONFIG kind=%s engine=%s edition=%s auth_env=%s source.auth=process_env source.env=%s",
        params.role,
        params.engine,
        profile.edition,
        profile.credentialEnv,
        sourceEnv,
      );
    }
    if (params.baseURL)
      debugf(
        "AGENT_CONFIG kind=%s engine=%s ignored.base_url reason=unsupported_by_agent",
        params.role,
        params.engine,
      );
  }
  return detectAgent(params.engine, cfg);
}
