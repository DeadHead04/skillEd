// Modified for the skilled TypeScript distribution.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseYAML, scalarString } from "../contracts/decode.js";
import type { MCPConfig, MCPServer } from "../contracts/schema.js";
import type {
  MCPConfig as RuntimeMCPConfig,
  MCPServerConfig,
} from "../runtime/types.js";
import { wholeShellEnvRef } from "../agent/mcp.js";
import { buildMockedRuntimeServerConfig } from "./mock-server.js";
export type LookupEnv = (name: string) => string | undefined;
export interface MCPServerFile {
  transport?: string;
  command?: string;
  args?: string[];
  endpoint?: string;
  env?: Record<string, string>;
  required_env?: string[];
  headers?: Record<string, string>;
  tool_responses?: Record<string, unknown>;
}
export class Provisioner {
  constructor(
    readonly skillDir = "",
    readonly lookupEnv: LookupEnv = (name) => process.env[name],
  ) {}
  async provision(
    cfg: MCPConfig,
  ): Promise<{ config: RuntimeMCPConfig; runEnv: Record<string, string> }> {
    const servers: MCPServerConfig[] = [],
      runEnv: Record<string, string> = {};
    for (const server of cfg.servers) {
      const resolved = await this.resolveServer(server);
      Object.assign(runEnv, resolved.env);
      servers.push(resolved);
    }
    return { config: { servers }, runEnv };
  }
  resolveConfigRef(ref: string): string {
    return path.isAbsolute(ref) || !this.skillDir
      ? path.normalize(ref)
      : path.join(this.skillDir, ref);
  }
  async resolveServer(server: MCPServer): Promise<MCPServerConfig> {
    validateServerMode(server);
    const ref = server.config_ref?.trim() ?? "",
      configRef = ref ? this.resolveConfigRef(ref) : "";
    let file: MCPServerFile = {};
    if (ref)
      try {
        file = await loadServerFile(configRef);
      } catch (e) {
        throw new Error(
          `failed to load mcp server ${JSON.stringify(server.name)} config_ref ${ref}: ${String(e)}`,
          { cause: e },
        );
      }
    if (server.mode === "mocked")
      return buildMockedRuntimeServerConfig(server, file, configRef);
    const endpoint = server.endpoint?.trim() || file.endpoint?.trim() || "",
      endpointEnv = endpoint
        ? resolveReferencedEnv(endpoint, this.lookupEnv)
        : {},
      command = server.command?.trim() || file.command?.trim() || "",
      args = server.args ?? file.args ?? [];
    const transport = resolveTransport(
      server.name,
      server.transport ?? "",
      file.transport ?? "",
      endpoint,
      command,
    );
    const env = resolveEnv(
        file.env ?? {},
        file.required_env ?? [],
        this.lookupEnv,
      ),
      headers = resolveHeaders(file.headers ?? {}, this.lookupEnv);
    Object.assign(env, headers.runEnv, endpointEnv);
    return {
      name: server.name,
      mode: server.mode,
      transport,
      command,
      args: [...args],
      endpoint,
      configRef,
      env,
      headers: headers.resolved,
      headerEnv: headers.envNames,
    };
  }
}
export function validateServerMode(server: MCPServer): void {
  if (!server.mode)
    throw new Error(
      `mcp server ${JSON.stringify(server.name)} mode is required`,
    );
  if (server.mode !== "real" && server.mode !== "mocked")
    throw new Error(
      `mcp server ${JSON.stringify(server.name)} mode must be one of: mocked, real`,
    );
}
export async function loadServerFile(file: string): Promise<MCPServerFile> {
  const raw = parseYAML(await readFile(file, "utf8")) as unknown;
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new Error("MCP server file must be a YAML mapping");
  const cfg = raw as Record<string, unknown>,
    out: MCPServerFile = {};
  for (const key of ["transport", "command", "endpoint"] as const) {
    if (cfg[key] == null) continue;
    if (typeof cfg[key] === "object")
      throw new Error(`${key} must be a string`);
    out[key] = scalarString(cfg, key, cfg[key]);
  }
  for (const key of ["args", "required_env"] as const) {
    if (cfg[key] == null) continue;
    if (
      !Array.isArray(cfg[key]) ||
      cfg[key].some((v) => v !== null && typeof v === "object")
    )
      throw new Error(`${key} must be a string sequence`);
    out[key] = cfg[key].map((v, i) =>
      scalarString(cfg[key] as object, String(i), v),
    );
  }
  for (const key of ["env", "headers"] as const) {
    if (cfg[key] == null) continue;
    const v = cfg[key];
    if (typeof v !== "object" || Array.isArray(v))
      throw new Error(`${key} must be a mapping`);
    out[key] = {};
    for (const [k, val] of Object.entries(v)) {
      if (val !== null && typeof val === "object")
        throw new Error(`${key}.${k} must be a string`);
      out[key][k] = scalarString(v, k, val);
    }
  }
  if (cfg.tool_responses != null) {
    if (
      typeof cfg.tool_responses !== "object" ||
      Array.isArray(cfg.tool_responses)
    )
      throw new Error("tool_responses must be a mapping");
    out.tool_responses = cfg.tool_responses as Record<string, unknown>;
  }
  return out;
}
export function resolveTransport(
  name: string,
  server: string,
  file: string,
  endpoint: string,
  command: string,
): string {
  let transport = server.trim() || file.trim();
  if (!transport) transport = command ? "stdio" : "http";
  if (transport === "streamable_http" || transport === "streamable-http")
    transport = "http";
  if (transport === "http") {
    if (!endpoint)
      throw new Error(
        `mcp server ${JSON.stringify(name)} real http mode requires endpoint or config_ref endpoint`,
      );
  } else if (transport === "stdio") {
    if (!command)
      throw new Error(
        `mcp server ${JSON.stringify(name)} real stdio mode requires command or config_ref command`,
      );
  } else
    throw new Error(
      `mcp server ${JSON.stringify(name)} transport must be one of: stdio, http`,
    );
  return transport;
}
export const wholeEnvRef = wholeShellEnvRef;
export function resolveReferencedEnv(
  value: string,
  lookup: LookupEnv,
): Record<string, string> {
  const whole = wholeEnvRef(value);
  if (!whole && value.startsWith("$"))
    throw new Error(
      `invalid environment variable reference ${JSON.stringify(value)}`,
    );
  const names = whole
    ? [whole]
    : [...value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]!);
  const resolved: Record<string, string> = {},
    missing: string[] = [];
  for (const name of names) {
    const val = lookup(name);
    if (!val) missing.push(name);
    else resolved[name] = val;
  }
  if (missing.length)
    throw new Error(
      `referenced environment variable ${missing.join(", ")} is not set`,
    );
  return resolved;
}
export function resolveEnvValue(value: string, lookup: LookupEnv): string {
  const env = resolveReferencedEnv(value, lookup),
    whole = wholeEnvRef(value);
  return whole
    ? env[whole]!
    : value.replace(
        /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
        (_m, key: string) => env[key]!,
      );
}
export function resolveEnv(
  env: Record<string, string>,
  required: string[],
  lookup: LookupEnv,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of required) {
    const value = lookup(name);
    if (!value)
      throw new Error(`required environment variable ${name} is not set`);
    out[name] = value;
  }
  for (const [key, value] of Object.entries(env))
    try {
      out[key] = resolveEnvValue(value, lookup);
    } catch (e) {
      throw new Error(key + ": " + String(e), { cause: e });
    }
  return out;
}
export function resolveHeaders(
  headers: Record<string, string>,
  lookup: LookupEnv,
): {
  resolved: Record<string, string>;
  envNames: Record<string, string>;
  runEnv: Record<string, string>;
} {
  const resolved: Record<string, string> = {},
    envNames: Record<string, string> = {},
    runEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    Object.assign(runEnv, resolveReferencedEnv(value, lookup));
    const whole = wholeEnvRef(value);
    if (whole) envNames[key] = whole;
    resolved[key] = value;
  }
  return { resolved, envNames, runEnv };
}
