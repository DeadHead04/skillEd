// Modified for the skilled TypeScript distribution.
import { isExactVersion, supportsVersion } from "../contracts/agentkind.js";
import {
  explicitConnectionValue,
  Resolver,
  type Protocol,
  type ResolvedAgentConfig,
  type ResolvedModelConnection,
  type ConnectionValue,
  type ValueSource,
} from "../credentials/index.js";
import { debugf, warnf } from "../logging/index.js";
export type { Protocol };
export interface Capabilities {
  protocol: Protocol;
  modelPolicy: "passthrough" | "codex_provider";
  supportsBaseURL: boolean;
  supportsVersion: boolean;
  supportedKwargs: string[];
  arbitraryKwargs: boolean;
}
export function capabilitiesForEngine(name: string): Capabilities {
  const c: Capabilities = {
    protocol: "custom",
    modelPolicy: "passthrough",
    supportsBaseURL: false,
    supportsVersion: false,
    supportedKwargs: [],
    arbitraryKwargs: false,
  };
  switch (name) {
    case "claude_code":
    case "claude-code":
      c.protocol = "anthropic";
      c.supportsBaseURL = true;
      break;
    case "codex":
      c.protocol = "openai";
      c.modelPolicy = "codex_provider";
      c.supportsBaseURL = true;
      c.supportedKwargs = [
        "bypass_sandbox",
        "max_jsonl_record_bytes",
        "max_jsonl_output_bytes",
        "codex_auth_file",
      ];
      break;
    case "opencode":
    case "qwen_code":
    case "qwen-code":
    case "qwen":
      c.protocol = "openai";
      c.supportsBaseURL = true;
      break;
    case "qodercli":
    case "qoder":
    case "qoder-cli":
      c.protocol = "qoder";
      c.supportedKwargs = ["edition"];
  }
  c.supportsVersion = supportsVersion(name);
  return c;
}
export function appendUniqueWarning(
  warnings: string[],
  warning: string,
): string[] {
  return warnings.includes(warning) ? warnings : [...warnings, warning];
}
export function codexCustomProviderUnavailableReason(
  provider: string,
  baseURL: string,
): string {
  if (!provider || provider === "openai") return "";
  if (!baseURL) return "requires base_url";
  if (!/^[A-Za-z0-9_-]+$/.test(provider))
    return "must contain only letters, digits, underscores, or hyphens";
  return "";
}
function explicit(
  value: string,
  source: ValueSource,
): ConnectionValue | undefined {
  if ((!source && !value) || source === "env" || source === "resolver")
    return undefined;
  return explicitConnectionValue(value, source);
}
function modelConnection(
  p: ResolvedAgentConfig,
  r: Resolver | null | undefined,
  protocol: Protocol,
): ResolvedModelConnection {
  if (p.appliedConnection?.protocol === protocol)
    return { ...p.appliedConnection, apiKey: p.appliedConnection.apiKey };
  if (r)
    return r.resolveModelConnection({
      provider: p.provider,
      protocol,
      apiKey: explicit(p.apiKey, p.apiKeySource),
      baseURL: explicit(p.baseURL, p.baseURLSource),
    });
  return {
    provider: p.provider,
    protocol,
    apiKey: p.apiKey,
    baseURL: p.baseURL,
    apiKeySet: !!p.apiKeySource || !!p.apiKey,
    baseURLSet: !!p.baseURLSource || !!p.baseURL,
    apiKeySource: p.apiKeySource,
    baseURLSource: p.baseURLSource,
    authMode: p.apiKey ? "injected" : "agent_local",
    routingMode: p.baseURL ? "explicit" : "agent_local",
  };
}
export function resolveAdapterConfig(
  input: ResolvedAgentConfig,
  resolver?: Resolver | null,
): ResolvedAgentConfig {
  const p = {
    ...input,
    role: input.role || "runner",
    kwargs: { ...input.kwargs },
    warnings: [...input.warnings],
  };
  const c = capabilitiesForEngine(p.engine);
  if (p.engine === "opencode" && p.provider === "anthropic")
    c.protocol = "anthropic";
  p.protocol = c.protocol;
  const connection = modelConnection(p, resolver, c.protocol);
  p.appliedAPIKey = connection.apiKey;
  p.appliedBaseURL = connection.baseURL;
  if (c.protocol === "qoder") {
    p.appliedAPIKey = "";
    p.appliedBaseURL = "";
    p.appliedProvider = "";
  } else if (c.modelPolicy === "codex_provider") {
    const reason = codexCustomProviderUnavailableReason(
      p.provider,
      p.appliedBaseURL,
    );
    if (reason) {
      p.warnings = appendUniqueWarning(
        p.warnings,
        `engine ${JSON.stringify(p.engine)} cannot apply provider ${JSON.stringify(p.provider)}: provider ${reason}; the provider override, endpoint, and provider-scoped credential are omitted and local Codex settings will be used`,
      );
      p.appliedAPIKey = "";
      p.appliedBaseURL = "";
      p.appliedProvider = "";
    } else
      p.appliedProvider = !p.appliedBaseURL
        ? ""
        : !p.provider || p.provider === "openai"
          ? "skilled-openai"
          : p.provider;
  } else p.appliedProvider = p.provider;
  p.appliedModel = p.model.trim();
  if (
    c.modelPolicy === "codex_provider" &&
    codexCustomProviderUnavailableReason(p.provider, p.appliedBaseURL)
  )
    p.appliedModel = "";
  if (p.appliedBaseURL && !c.supportsBaseURL) {
    p.warnings = appendUniqueWarning(
      p.warnings,
      `engine ${JSON.stringify(p.engine)} does not support base_url; the configured endpoint is ignored`,
    );
    p.appliedBaseURL = "";
  }
  p.appliedVersion = "";
  if (p.version) {
    if (!c.supportsVersion)
      p.warnings = appendUniqueWarning(
        p.warnings,
        `engine ${JSON.stringify(p.engine)} does not support engine.version; the configured version ${JSON.stringify(p.version)} is ignored`,
      );
    else if (!isExactVersion(p.version))
      p.warnings = appendUniqueWarning(
        p.warnings,
        `engine ${JSON.stringify(p.engine)} requires an exact semantic version for version selection; the configured version ${JSON.stringify(p.version)} is ignored`,
      );
    else p.appliedVersion = p.version;
  }
  if (!c.arbitraryKwargs)
    for (const key of Object.keys(p.kwargs).sort()) {
      const value = p.kwargs[key];
      if (!c.supportedKwargs.includes(key)) {
        p.warnings = appendUniqueWarning(
          p.warnings,
          `engine ${JSON.stringify(p.engine)} does not support kwarg ${JSON.stringify(key)}; the configured value is ignored`,
        );
        delete p.kwargs[key];
        continue;
      }
      if (key === "edition") {
        const edition = value.trim().toLowerCase();
        if (edition && !["global", "cn"].includes(edition)) {
          p.warnings = appendUniqueWarning(
            p.warnings,
            `engine ${JSON.stringify(p.engine)} does not support the configured edition; edition "global" will be used`,
          );
          p.kwargs[key] = "global";
        }
      } else if (key === "bypass_sandbox") {
        if (
          ![
            "1",
            "t",
            "T",
            "TRUE",
            "true",
            "True",
            "0",
            "f",
            "F",
            "FALSE",
            "false",
            "False",
          ].includes(value.trim())
        ) {
          p.warnings = appendUniqueWarning(
            p.warnings,
            `engine ${JSON.stringify(p.engine)} requires boolean kwarg ${JSON.stringify(key)}; the configured value is ignored`,
          );
          delete p.kwargs[key];
        }
      } else if (key === "codex_auth_file") {
        // Filesystem validation belongs to the opt-in Docker login adapter;
        // this is a host path, not one of the numeric JSONL size options.
        continue;
      } else if (
        !/^[+]?\d+$/.test(value.trim()) ||
        Number(value) <= 0 ||
        Number(value) >= 2 ** 63
      ) {
        p.warnings = appendUniqueWarning(
          p.warnings,
          `engine ${JSON.stringify(p.engine)} requires positive integer kwarg ${JSON.stringify(key)}; the configured value is ignored`,
        );
        delete p.kwargs[key];
      }
    }
  const applied = { ...connection, apiKey: connection.apiKey };
  applied.provider = p.appliedProvider;
  if (applied.apiKey !== p.appliedAPIKey) {
    applied.apiKeySet = !!p.appliedAPIKey;
    if (!applied.apiKeySet) applied.apiKeySource = "";
  }
  if (applied.baseURL !== p.appliedBaseURL) {
    applied.baseURLSet = !!p.appliedBaseURL;
    if (!applied.baseURLSet) applied.baseURLSource = "";
  }
  applied.apiKey = p.appliedAPIKey;
  applied.baseURL = p.appliedBaseURL;
  applied.authMode = applied.apiKey ? "injected" : "agent_local";
  applied.routingMode = applied.baseURL ? "explicit" : "agent_local";
  Object.defineProperty(applied, "apiKey", {
    value: applied.apiKey,
    enumerable: false,
    writable: true,
  });
  p.appliedConnection = applied;
  return p;
}
export function logAdapterConfig(params: ResolvedAgentConfig): void {
  debugf(
    "AGENT_CONFIG kind=%s engine=%s protocol=%s requested.provider=%s applied.provider=%s requested.model=%s applied.model=%s requested.version=%s applied.version=%s",
    params.role,
    params.engine,
    params.protocol,
    params.provider,
    params.appliedProvider,
    params.model,
    params.appliedModel,
    params.version,
    params.appliedVersion,
  );
  for (const warning of params.warnings)
    warnf(
      "AGENT_CONFIG kind=%s engine=%s warning=%s",
      params.role,
      params.engine,
      warning,
    );
}
