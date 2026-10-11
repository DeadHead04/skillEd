// Modified for the skilled TypeScript distribution.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { decode, parseYAML } from "../contracts/decode.js";
import type { UserConfig, Telemetry } from "../contracts/schema.js";
export type { UserConfig, Telemetry };
export const configEnvVar = "SKILLED_CONFIG";
export const projectConfigFile = ".skilled.yaml";
export const userConfigDir = "skilled";
export const userConfigFile = "config.yaml";
export interface Source {
  kind: string;
  path?: string;
}
export interface LoadOptions {
  explicitPath?: string;
  workingDir?: string;
  homeDir?: string;
  env?: (name: string) => string;
  warnings?: { write: (message: string) => unknown };
}
export function validate(c: UserConfig): void {
  const p = c.telemetry.traces.protocol.trim();
  if (p && !["grpc", "http/protobuf"].includes(p))
    throw new Error(
      `invalid telemetry.traces.protocol ${JSON.stringify(p)}: must be "grpc" or "http/protobuf"`,
    );
}
export function overlay(c: UserConfig, other: UserConfig): void {
  for (const k of ["schema_version", "kind"] as const)
    if (other[k]) c[k] = other[k];
  for (const k of ["service_name", "traces_exporter"] as const)
    if (other.telemetry[k]) c.telemetry[k] = other.telemetry[k];
  for (const k of ["endpoint", "protocol"] as const)
    if (other.telemetry.traces[k])
      c.telemetry.traces[k] = other.telemetry.traces[k];
  if (other.telemetry.verbose !== null)
    c.telemetry.verbose = other.telemetry.verbose;
  Object.assign(
    c.telemetry.resource_attributes,
    other.telemetry.resource_attributes,
  );
  Object.assign(c.env, other.env);
  for (const [kind, kwargs] of Object.entries(other.runtime_kwargs))
    c.runtime_kwargs[kind] = { ...c.runtime_kwargs[kind], ...kwargs };
}
export function resolveUserConfigPath(opts: LoadOptions): string {
  const env = opts.env ?? ((k) => process.env[k] ?? "");
  return (
    env(configEnvVar) ||
    (env("XDG_CONFIG_HOME")
      ? path.join(env("XDG_CONFIG_HOME"), userConfigDir, userConfigFile)
      : path.join(
          opts.homeDir || homedir(),
          ".config",
          userConfigDir,
          userConfigFile,
        ))
  );
}
export function resolveProjectConfigPath(opts: LoadOptions): string {
  return path.join(opts.workingDir || process.cwd(), projectConfigFile);
}
async function loadConfigFile(file: string): Promise<UserConfig | undefined> {
  let data: string;
  try {
    data = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`read config ${file}: ${(e as Error).message}`, {
      cause: e,
    });
  }
  try {
    return decode<UserConfig>("UserConfig", parseYAML(data));
  } catch (e) {
    throw new Error(`parse config ${file}: ${(e as Error).message}`, {
      cause: e,
    });
  }
}
export async function loadFile(file: string): Promise<UserConfig> {
  const cfg = await loadConfigFile(file);
  if (!cfg) throw new Error("config file not found: " + file);
  try {
    validate(cfg);
  } catch (e) {
    throw new Error(`validate ${file}: ${(e as Error).message}`, { cause: e });
  }
  return cfg;
}
export async function loadEffective(
  opts: LoadOptions = {},
): Promise<{ config: UserConfig; sources: Source[] }> {
  const cfg = decode<UserConfig>("UserConfig", {}),
    sources: Source[] = [{ kind: "embed" }],
    warn = opts.warnings ?? process.stderr;
  for (const [kind, file] of [
    ["user", resolveUserConfigPath(opts)],
    ["project", resolveProjectConfigPath(opts)],
  ]) {
    if (!file) continue;
    try {
      const loaded = await loadConfigFile(file);
      if (loaded) {
        overlay(cfg, loaded);
        sources.push({ kind, path: file });
      }
    } catch (e) {
      warn.write(
        `warning: ignoring ${kind} config ${file}: ${(e as Error).message}\n`,
      );
    }
  }
  if (opts.explicitPath) {
    const loaded = await loadConfigFile(opts.explicitPath);
    if (!loaded) throw new Error("config file not found: " + opts.explicitPath);
    overlay(cfg, loaded);
    sources.push({ kind: "explicit", path: opts.explicitPath });
  }
  try {
    validate(cfg);
  } catch (e) {
    const paths = sources.flatMap((s) => (s.path ? [s.path] : []));
    throw new Error(
      paths.length
        ? `config validation failed (loaded from [${paths.join(" ")}]): ${(e as Error).message}`
        : (e as Error).message,
      { cause: e },
    );
  }
  return { config: cfg, sources };
}
export function serializeResourceAttributes(
  attrs: Record<string, string>,
): string {
  return Object.keys(attrs)
    .sort()
    .filter((k) => k.trim() && attrs[k].trim())
    .map((k) => k + "=" + attrs[k])
    .join(",");
}
export function telemetryEnv(t: Telemetry): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of [
    ["OTEL_SERVICE_NAME", t.service_name],
    ["OTEL_TRACES_EXPORTER", t.traces_exporter],
    ["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", t.traces.endpoint],
    ["OTEL_EXPORTER_OTLP_TRACES_PROTOCOL", t.traces.protocol],
  ])
    if (v) out[k] = v;
  if (Object.keys(t.resource_attributes).length)
    out.OTEL_RESOURCE_ATTRIBUTES = serializeResourceAttributes(
      t.resource_attributes,
    );
  if (t.verbose)
    for (const k of [
      "OTEL_LOG_USER_PROMPTS",
      "OTEL_LOG_TOOL_CONTENT",
      "OTEL_LOG_TOOL_DETAILS",
    ])
      out[k] = "1";
  return out;
}
export function applyEnv(
  c: UserConfig,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const pending = telemetryEnv(c.telemetry);
  for (const [k, v] of Object.entries(c.env))
    if (v && !(k in pending)) pending[k] = v;
  const applied: string[] = [];
  for (const k of Object.keys(pending).sort()) {
    if (Object.hasOwn(env, k)) continue;
    if (!k || k.includes("=") || k.includes("\0") || pending[k].includes("\0"))
      throw new Error("setenv: invalid argument");
    env[k] = pending[k];
    applied.push(k);
  }
  return applied;
}
export function mergeKwargs(
  c: UserConfig,
  envType: string,
  evalKwargs: Record<string, string>,
): Record<string, string> {
  return { ...c.runtime_kwargs[envType], ...evalKwargs };
}
const contextKey = Symbol("user-config");
export interface ConfigContext {
  [contextKey]?: { config: UserConfig; sources: Source[] };
}
export function withContext<T extends object>(
  context: T,
  config: UserConfig,
  sources: Source[],
): T & ConfigContext {
  return { ...context, [contextKey]: { config, sources } };
}
export function fromContext(
  context: ConfigContext | null | undefined,
): { config: UserConfig; sources: Source[] } | undefined {
  return context?.[contextKey];
}
/** No current UserConfig fields carry secret metadata. Return an independent value. */
export function redact(c: UserConfig): UserConfig {
  return structuredClone(c);
}
export function redactTaggedFields<T extends object>(
  value: T,
  secretPaths: string[],
): T {
  const result = structuredClone(value);
  for (const path of secretPaths) {
    const keys = path.split(".");
    let parent: Record<string, unknown> = result as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) {
      if (!parent[key] || typeof parent[key] !== "object") {
        parent = {};
        break;
      }
      parent = parent[key] as Record<string, unknown>;
    }
    const key = keys.at(-1)!;
    const v = parent[key];
    if (typeof v === "string" && v && !/^\$\{[A-Z0-9_]+\}$/.test(v))
      parent[key] = "***";
  }
  return result;
}
