// Modified for the skilled TypeScript distribution.
import { shellQuote } from "./base.js";
import type { Runtime, MCPConfig } from "./types.js";
import type { MCPServerConfig } from "../runtime/types.js";
export const shellEnvNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
export function wholeShellEnvRef(value: string): string | undefined {
  return (
    /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value)?.[1] ??
    /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(value)?.[1]
  );
}
export function sortedMapKeys(values: Record<string, string> = {}): string[] {
  return Object.keys(values).sort();
}
export function sortedUniqueMapValues(
  values: Record<string, string> = {},
): string[] {
  return [...new Set(Object.values(values).filter(Boolean))].sort();
}
export function shellEnvAssignment(name: string): string {
  if (!shellEnvNamePattern.test(name))
    throw new Error(
      `environment variable name ${JSON.stringify(name)} must match ${shellEnvNamePattern.source}`,
    );
  return shellQuote(name + "=") + '"$' + name + '"';
}
export function shellExpandedValue(value: string): string {
  const whole = wholeShellEnvRef(value);
  if (whole) return '"${' + whole + '}"';
  if (value.startsWith("$"))
    throw new Error(
      `invalid environment variable reference ${JSON.stringify(value)}`,
    );
  let out = "",
    pos = 0;
  for (const match of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    if (match.index > pos) out += shellQuote(value.slice(pos, match.index));
    out += '"${' + match[1] + '}"';
    pos = match.index + match[0].length;
  }
  return pos
    ? out + (pos < value.length ? shellQuote(value.slice(pos)) : "")
    : shellQuote(value);
}
export async function installMCPServers(
  rt: Runtime,
  cfg: MCPConfig,
  build: (server: MCPServerConfig) => string,
  signal?: AbortSignal,
): Promise<void> {
  for (const server of cfg.servers) {
    const command = build(server);
    let result;
    try {
      result = await rt.exec(command, { env: server.env, signal });
    } catch (e) {
      throw new Error(
        `failed to install MCP server ${server.name}: ${String(e)}`,
        { cause: e },
      );
    }
    if (result.exitCode !== 0)
      throw new Error(
        `MCP server ${server.name} installation failed: ${result.stderr}`,
      );
  }
}
export function buildClaudeCompatibleMCPInstallCmd(
  binary: string,
  agentName: string,
  server: MCPServerConfig,
): string {
  let cmd =
    binary +
    " mcp remove --scope project " +
    shellQuote(server.name) +
    " >/dev/null 2>&1 || true\n";
  if (server.transport === "stdio") {
    if (!server.command)
      throw new Error(
        `mcp server ${JSON.stringify(server.name)} stdio transport requires command`,
      );
    cmd += binary + " mcp add --scope project " + shellQuote(server.name);
    for (const key of sortedMapKeys(server.env))
      cmd += " -e " + shellEnvAssignment(key);
    cmd += " -- " + shellQuote(server.command);
    for (const arg of server.args ?? []) cmd += " " + shellQuote(arg);
  } else if (!server.transport || server.transport === "http") {
    if (!server.endpoint)
      throw new Error(
        `mcp server ${JSON.stringify(server.name)} http transport requires endpoint`,
      );
    cmd +=
      binary +
      " mcp add --scope project --transport http " +
      shellQuote(server.name) +
      " " +
      shellExpandedValue(server.endpoint);
    for (const key of sortedMapKeys(server.headers))
      cmd +=
        " --header " + shellExpandedValue(key + ":" + server.headers![key]);
  } else
    throw new Error(
      `mcp server ${JSON.stringify(server.name)} transport ${JSON.stringify(server.transport)} is not supported by ${agentName}`,
    );
  return cmd;
}
