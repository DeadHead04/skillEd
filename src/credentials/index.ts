// Modified for the skilled TypeScript distribution.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parseDotenv } from "./dotenv.js";
import { debugf, warnf } from "../logging/index.js";
import { parseYAML, decode, scalarString } from "../contracts/decode.js";
import { isBuiltinEngineName } from "../contracts/agentkind.js";
import type {
  EngineConfig,
  JudgeConfig,
  CustomEngineConfig,
} from "../contracts/schema.js";
export type ValueSource =
  | ""
  | "config"
  | "judge_config"
  | "runner"
  | "env"
  | "resolver"
  | "cli";
export type Protocol =
  | "anthropic"
  | "openai"
  | "qoder"
  | "custom"
  | (string & {});
export interface APIKeyConfig {
  provider: string;
  baseURL: string;
  apiKey: string;
  apiKeyVar: string;
}
export interface ConnectionValue {
  value: string;
  source: ValueSource;
  set: boolean;
}
export function explicitConnectionValue(
  value: string,
  source: ValueSource,
): ConnectionValue {
  return { value, source, set: true };
}
const absent = (): ConnectionValue => ({ value: "", source: "", set: false });
export interface ProviderEndpointConfig {
  apiKey: ConnectionValue;
  baseURL: ConnectionValue;
}
export interface ProviderConfiguration extends ProviderEndpointConfig {
  provider: string;
  endpoints: Record<string, ProviderEndpointConfig>;
}
export interface ModelConnectionSpec {
  provider: string;
  protocol: Protocol;
  apiKey?: ConnectionValue;
  baseURL?: ConnectionValue;
}
export interface ResolvedModelConnection {
  provider: string;
  protocol: Protocol;
  apiKey: string;
  baseURL: string;
  apiKeySet: boolean;
  baseURLSet: boolean;
  apiKeySource: ValueSource;
  baseURLSource: ValueSource;
  authMode: "injected" | "agent_local";
  routingMode: "explicit" | "native_config" | "agent_local" | "unresolved";
}
export function defaultConfPath(): string {
  const home = homedir();
  return home ? path.join(home, ".skilled", "credentials.yaml") : "";
}
export function maskAPIKey(key: string): string {
  return Buffer.byteLength(key) <= 4
    ? "****"
    : Buffer.from(key).subarray(0, 2).toString() +
        "****" +
        Buffer.from(key).subarray(-2).toString();
}
function fileValue(o: Record<string, unknown>, key: string): ConnectionValue {
  const value = o[key];
  if (value != null && typeof value === "object")
    throw new Error(`cannot unmarshal ${key} into string`);
  return {
    value: value == null ? "" : scalarString(o, key, value),
    source: "resolver",
    set: Object.hasOwn(o, key),
  };
}
export class Resolver {
  private readonly creds = new Map<string, APIKeyConfig>();
  private readonly providers = new Map<string, ProviderConfiguration>();
  readonly env: NodeJS.ProcessEnv;
  constructor(
    readonly confPath = "",
    options: { env?: NodeJS.ProcessEnv; warn?: (message: string) => void } = {},
  ) {
    this.env = options.env ?? process.env;
    this.warn = options.warn ?? ((m) => warnf("%s", m));
  }
  private readonly warn: (message: string) => void;
  async load(options: { dotenvPath?: string } = {}): Promise<void> {
    try {
      const data = await readFile(
        options.dotenvPath ?? path.resolve(".env"),
        "utf8",
      );
      const values = parseDotenv(data);
      for (const [key, value] of Object.entries(values)) {
        if (this.env[key] === undefined) this.env[key] = value;
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        this.warn(`Failed to load .env file: ${(e as Error).message}`);
    }
    if (this.confPath)
      try {
        await this.loadFromFile(this.confPath);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT")
          this.warn(
            `Failed to parse credential config file ${this.confPath}: ${(e as Error).message}. Check file format.`,
          );
      }
  }
  async loadFromFile(file: string): Promise<void> {
    const raw = parseYAML(await readFile(file, "utf8")) as {
      providers?: Record<string, Record<string, unknown>>;
    } | null;
    if (raw != null && (typeof raw !== "object" || Array.isArray(raw)))
      throw new Error("credentials document must be a mapping");
    if (raw && "schema_version" in raw)
      fileValue(raw as Record<string, unknown>, "schema_version");
    const providers = raw?.providers ?? {};
    if (typeof providers !== "object" || Array.isArray(providers))
      throw new Error("providers must be a mapping");
    const staged: Array<[string, ProviderConfiguration, APIKeyConfig]> = [];
    for (const [name, p0] of Object.entries(providers)) {
      const p = p0 ?? {};
      if (typeof p !== "object" || Array.isArray(p))
        throw new Error(`provider ${name} must be a mapping`);
      const cfg: ProviderConfiguration = {
        provider: name,
        apiKey: fileValue(p, "api_key"),
        baseURL: fileValue(p, "base_url"),
        endpoints: {},
      };
      for (const protocol of ["openai", "anthropic"])
        if (p[protocol] != null) {
          const endpoint = p[protocol] as Record<string, unknown>;
          if (typeof endpoint !== "object" || Array.isArray(endpoint))
            throw new Error(`provider ${name}.${protocol} must be a mapping`);
          cfg.endpoints[protocol] = {
            apiKey: fileValue(endpoint, "api_key"),
            baseURL: fileValue(endpoint, "base_url"),
          };
        }
      const cred: APIKeyConfig = {
        provider: name,
        apiKey: cfg.apiKey.value,
        baseURL: cfg.baseURL.value,
        apiKeyVar: "",
      };
      if (cfg.endpoints.openai) {
        cred.baseURL ||= cfg.endpoints.openai.baseURL.value;
        cred.apiKey ||= cfg.endpoints.openai.apiKey.value;
      }
      if (cfg.endpoints.anthropic)
        cred.apiKey ||= cfg.endpoints.anthropic.apiKey.value;
      staged.push([name, cfg, cred]);
    }
    for (const [name, cfg, cred] of staged) {
      this.providers.set(name, cfg);
      this.creds.set(name, cred);
    }
  }
  get(provider: string): APIKeyConfig | undefined {
    const cred = this.creds.get(provider);
    return cred && { ...cred };
  }
  getProviderConfiguration(
    provider: string,
  ): ProviderConfiguration | undefined {
    const cfg = this.providers.get(provider);
    if (!cfg) return undefined;
    const result = structuredClone(cfg);
    Object.defineProperty(result, "apiKey", {
      value: result.apiKey,
      enumerable: false,
      writable: true,
    });
    for (const endpoint of Object.values(result.endpoints))
      Object.defineProperty(endpoint, "apiKey", {
        value: endpoint.apiKey,
        enumerable: false,
        writable: true,
      });
    return result;
  }
  hasProvider(name: string): boolean {
    return hasProvider(name, this);
  }
  resolveModelConnection(spec: ModelConnectionSpec): ResolvedModelConnection {
    const provider = this.providers.get(spec.provider);
    const endpoint = provider?.endpoints[spec.protocol];
    const select = (
      explicit: ConnectionValue | undefined,
      kind: "API_KEY" | "BASE_URL",
      key: "apiKey" | "baseURL",
    ): ConnectionValue => {
      const env = lookupProviderEnv(spec.provider, kind, this.env);
      const protocol = endpoint?.[key];
      return (
        [
          explicit,
          env ? explicitConnectionValue(env, "env") : undefined,
          protocol?.set ? protocol : provider?.[key],
        ].find((v) => v?.set) ?? absent()
      );
    };
    const apiKey = select(spec.apiKey, "API_KEY", "apiKey"),
      baseURL = select(spec.baseURL, "BASE_URL", "baseURL");
    const result: ResolvedModelConnection = {
      provider: spec.provider,
      protocol: spec.protocol,
      apiKey: apiKey.value,
      baseURL: baseURL.value,
      apiKeySet: apiKey.set,
      baseURLSet: baseURL.set,
      apiKeySource: apiKey.source,
      baseURLSource: baseURL.source,
      authMode: apiKey.value ? "injected" : "agent_local",
      routingMode: baseURL.value ? "explicit" : "agent_local",
    };
    Object.defineProperty(result, "apiKey", {
      value: apiKey.value,
      writable: true,
      enumerable: false,
    });
    return result;
  }
}
export function lookupProviderEnv(
  provider: string,
  kind: "MODEL" | "API_KEY" | "BASE_URL",
  env: NodeJS.ProcessEnv = process.env,
): string {
  return provider ? (env[provider.toUpperCase() + "_" + kind] ?? "") : "";
}
export function hasProvider(name: string, resolver?: Resolver | null): boolean {
  if (!name) return false;
  if (["anthropic", "openai"].includes(name.toLowerCase())) return true;
  if (resolver?.get(name)) return true;
  const env = resolver?.env ?? process.env;
  if (
    lookupProviderEnv(name, "API_KEY", env) ||
    lookupProviderEnv(name, "BASE_URL", env)
  )
    return true;
  return (
    name.toLowerCase() === "qoder" &&
    [
      "QODER_PERSONAL_ACCESS_TOKEN",
      "QODERCN_PERSONAL_ACCESS_TOKEN",
      "QODER_CN_ACCESS_TOKEN",
    ].some((k) => !!env[k])
  );
}
export function resolveModelRef(
  raw: string,
  resolver?: Resolver | null,
): { provider: string; name: string } {
  const i = raw.indexOf("/");
  if (i > 0 && i < raw.length - 1 && hasProvider(raw.slice(0, i), resolver))
    return { provider: raw.slice(0, i), name: raw.slice(i + 1) };
  return { provider: "", name: raw };
}
export interface CLIOverrides {
  provider?: string;
  model?: string;
  apiKey?: string;
}
export interface ResolvedAgentConfig {
  role: "runner" | "judge";
  engine: string;
  version: string;
  appliedVersion: string;
  protocol: string;
  provider: string;
  model: string;
  appliedProvider: string;
  appliedModel: string;
  appliedAPIKey: string;
  appliedBaseURL: string;
  appliedConnection?: ResolvedModelConnection;
  apiKey: string;
  baseURL: string;
  kwargs: Record<string, string>;
  warnings: string[];
  custom: CustomEngineConfig | null;
  providerSource: ValueSource;
  modelSource: ValueSource;
  apiKeySource: ValueSource;
  baseURLSource: ValueSource;
}
interface ResolveInput {
  role: "runner" | "judge";
  engine: EngineConfig;
  provider: string;
  model: string;
  baseURL: string;
  valueSource: ValueSource;
  fallback?: ResolvedAgentConfig;
  resolver?: Resolver | null;
  cli: CLIOverrides;
}
function resolve(input: ResolveInput): ResolvedAgentConfig {
  const e = input.engine;
  const p: ResolvedAgentConfig = {
    role: input.role,
    engine: e.name,
    version: e.version,
    appliedVersion: "",
    protocol: "",
    provider: input.provider,
    model: input.model,
    baseURL: input.baseURL,
    apiKey: "",
    appliedProvider: "",
    appliedModel: "",
    appliedAPIKey: "",
    appliedBaseURL: "",
    kwargs: structuredClone(e.kwargs),
    warnings: [],
    custom: isBuiltinEngineName(e.name) ? null : structuredClone(e.custom),
    providerSource: input.provider ? input.valueSource : "",
    modelSource: input.model ? input.valueSource : "",
    apiKeySource: "",
    baseURLSource: input.baseURL ? input.valueSource : "",
  };
  if (e.entry.trim())
    p.warnings.push(
      "engine.entry is deprecated and ignored; use engine.custom.local.command and args instead",
    );
  if (Object.keys(e.model.params).length)
    p.warnings.push(
      "engine.model.params is deprecated and ignored; use engine.kwargs or engine.custom.kwargs instead",
    );
  const cli = input.cli;
  if (cli.provider) {
    p.provider = cli.provider;
    p.providerSource = "cli";
    if (cli.model) {
      p.model = cli.model;
      p.modelSource = "cli";
    }
  } else if (cli.model) {
    if (p.engine === "opencode") {
      p.model = cli.model;
      p.modelSource = "cli";
    } else {
      const ref = resolveModelRef(cli.model, input.resolver);
      p.provider = ref.provider;
      p.model = ref.name;
      p.providerSource = p.provider ? "cli" : "";
      p.modelSource = "cli";
    }
  }
  const f = input.fallback;
  if (f) {
    if (!p.provider && f.provider) {
      p.provider = f.provider;
      p.providerSource = "runner";
    }
    if (!p.model && f.model) {
      p.model = f.model;
      p.modelSource = "runner";
    }
    if (p.provider === f.provider && !p.baseURL && f.baseURL) {
      p.baseURL = f.baseURL;
      p.baseURLSource = "runner";
    }
  }
  if (p.provider) {
    const env = input.resolver?.env ?? process.env;
    for (const [kind, key, source] of [
      ["MODEL", "model", "modelSource"],
      ["API_KEY", "apiKey", "apiKeySource"],
      ["BASE_URL", "baseURL", "baseURLSource"],
    ] as const) {
      if (kind === "MODEL" && p.modelSource === "cli") continue;
      const value = lookupProviderEnv(p.provider, kind, env);
      if (value) {
        p[key] = value;
        p[source] = "env";
        continue;
      }
      if (kind === "MODEL") continue;
      const cred = input.resolver?.get(p.provider);
      if (!cred) continue;
      if (kind === "API_KEY" && cred.apiKey) {
        p.apiKey = cred.apiKey;
        p.apiKeySource = "resolver";
      }
      if (kind === "BASE_URL" && !p.baseURL && cred.baseURL) {
        p.baseURL = cred.baseURL;
        p.baseURLSource = "resolver";
      }
    }
  }
  if (f && p.provider === f.provider && !p.apiKey && f.apiKey) {
    p.apiKey = f.apiKey;
    p.apiKeySource = "runner";
  }
  if (cli.apiKey) {
    p.apiKey = cli.apiKey;
    p.apiKeySource = "cli";
  }
  if (
    (!cli.provider || !cli.model) &&
    p.model === "auto" &&
    !p.custom &&
    !["qodercli", "qoder", "qoder-cli"].includes(p.engine)
  )
    p.model = "";
  if (p.provider)
    debugf(
      "AGENT_CONFIG kind=%s engine=%s provider=%s source.provider=%s",
      p.role,
      p.engine,
      p.provider,
      p.providerSource,
    );
  if (p.model)
    debugf(
      "AGENT_CONFIG kind=%s engine=%s model=%s source.model=%s",
      p.role,
      p.engine,
      p.model,
      p.modelSource,
    );
  if (p.apiKey)
    debugf(
      "AGENT_CONFIG kind=%s engine=%s auth_configured=true",
      p.role,
      p.engine,
    );
  if (p.baseURL)
    debugf(
      "AGENT_CONFIG kind=%s engine=%s base_url=%s source.base_url=%s",
      p.role,
      p.engine,
      p.baseURL,
      p.baseURLSource,
    );
  return p;
}
export function resolveRunnerConfig(
  engine: EngineConfig,
  resolver?: Resolver | null,
  cli: CLIOverrides = {},
): ResolvedAgentConfig {
  return resolve({
    role: "runner",
    engine,
    provider: engine.model.provider,
    model: engine.model.name,
    baseURL: engine.model.base_url,
    valueSource: "config",
    resolver,
    cli,
  });
}
export function resolveJudgeConfig(
  judge: JudgeConfig,
  runner: ResolvedAgentConfig,
  resolver?: Resolver | null,
): ResolvedAgentConfig {
  const i = judge.model.indexOf("/");
  const split = i > 0 && i < judge.model.length - 1;
  const engine = decode<EngineConfig>("EngineConfig", {});
  engine.name = runner.engine;
  engine.version = runner.version;
  engine.kwargs = { ...runner.kwargs };
  engine.custom = runner.custom;
  const result = resolve({
    role: "judge",
    engine,
    provider: split ? judge.model.slice(0, i) : "",
    model: split ? judge.model.slice(i + 1) : judge.model,
    baseURL: "",
    valueSource: "judge_config",
    fallback:
      runner.provider || runner.model || runner.apiKey || runner.baseURL
        ? runner
        : undefined,
    resolver,
    cli: {},
  });
  if (result.provider === runner.provider && runner.appliedConnection?.protocol)
    result.appliedConnection = runner.appliedConnection;
  return result;
}
export const envOpenAIAPIKey = "OPENAI_API_KEY";
export const envOpenAIBaseURL = "OPENAI_BASE_URL";
export const envOpenAIModel = "OPENAI_MODEL";
export const envAnthropicAPIKey = "ANTHROPIC_API_KEY";
export const envAnthropicAuthToken = "ANTHROPIC_AUTH_TOKEN";
export const envAnthropicBaseURL = "ANTHROPIC_BASE_URL";
export const envQoderPersonalAccessToken = "QODER_PERSONAL_ACCESS_TOKEN";
export const envQoderCNPersonalAccessToken = "QODERCN_PERSONAL_ACCESS_TOKEN";
export const envQoderCNAccessToken = "QODER_CN_ACCESS_TOKEN";
