// Modified for the skilled TypeScript distribution.
import { realpath } from "node:fs/promises";
import path from "node:path";
import type { Runtime, ExecOptions } from "./types.js";
import { downloadSessionArtifact } from "./base.js";
import { debugf } from "../logging/index.js";
export const sessionCleanupTimeout = 30_000;
export function sessionCleanupOptions(opts: ExecOptions = {}): ExecOptions {
  return { ...opts, signal: AbortSignal.timeout(sessionCleanupTimeout) };
}
export interface AgentSessionLookup {
  projectsRootTmpl: string;
  sessionDepth?: number;
  findExtra?: string;
}
export const canonicalWorkspaceKey = (workspace: string): string =>
  workspace.replace(/[^A-Za-z0-9]/gu, "-");
export function workspaceCwdMarkers(workspace: string): string[] {
  const encoded = JSON.stringify(workspace)
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  return ['"cwd":', '"directories":['].flatMap((k) => [
    k + encoded,
    k + " " + encoded,
  ]);
}
export async function workspaceForRuntime(rt: Runtime): Promise<string> {
  const workspace = rt.workspace();
  if (rt.shell().goos === "windows") return workspace;
  try {
    return await realpath(workspace);
  } catch {
    return workspace;
  }
}
export function extractSessionIDFromPath(sessionPath: string): string {
  return path.basename(sessionPath, path.extname(sessionPath));
}
const lookupTemplate =
  'home=$(printenv HOME); [ -n "$home" ] || exit 0\nroot="%s"; [ -d "$root" ] || exit 0\nws=$(printenv %s); wskey=$(printenv %s); [ -n "$wskey" ] || exit 0\ntmp=$(mktemp) || exit 0; list=$(mktemp) || exit 0; marks=$(mktemp) || exit 0\ntrap \'rm -f "$tmp" "$list" "$marks"\' 0\nprintenv %s >"$marks" || true\nrecords_cwd() {\n  head -c 65536 "$1" 2>/dev/null | grep -qE \'"cwd"[[:space:]]*:|"workspace-directories"\'\n}\nkeep_recording_ws() {\n  : >"$tmp"\n  [ -s "$marks" ] || return 0\n  while IFS= read -r c || [ -n "$c" ]; do\n    if head -c 65536 "$c" 2>/dev/null | grep %s "$marks"; then printf \'%%s\\n\' "$c" >>"$tmp"; fi\n  done <"$1"\n}\nany_records_cwd() {\n  while IFS= read -r c || [ -n "$c" ]; do\n    if records_cwd "$c"; then return 0; fi\n  done <"$1"\n  return 1\n}\nfind "$root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null >"$tmp" || true\nawk -v key="$wskey" \'{n=$0; sub(/.*\\//,"",n); gsub(/[^a-zA-Z0-9]/,"-",n); if (%s) print}\' "$tmp" >"$list" || true\n: >"$tmp"\nwhile IFS= read -r d || [ -n "$d" ]; do\n  find "$d" -maxdepth %d -type f -name "*.jsonl"%s 2>/dev/null >>"$tmp" || true\ndone <"$list"\nif [ -s "$tmp" ]; then\n  cp "$tmp" "$list"\n  keep_recording_ws "$list"\n  if [ ! -s "$tmp" ] && ! any_records_cwd "$list"; then cp "$list" "$tmp"; fi\nelse\n  find "$root" -maxdepth %d -type f -name "*.jsonl"%s 2>/dev/null >"$list" || true\n  keep_recording_ws "$list"\nfi\nbest=; ts=-1\nwhile IFS= read -r p || [ -n "$p" ]; do\n  [ -f "$p" ] || continue\n  m=$(stat -c %%Y "$p" 2>/dev/null || stat -f %%m "$p" 2>/dev/null) || continue\n  case $m in \'\'|*[!0-9]*) continue;; esac\n  if [ "$ts" -eq -1 ] || [ "$m" -gt "$ts" ]; then ts=$m; best=$p; fi\ndone <"$tmp"\n%s';
export function buildSessionLookupScript(
  lookup: AgentSessionLookup,
  windows = false,
): string {
  const depth = (lookup.sessionDepth ?? 0) > 0 ? lookup.sessionDepth! : 1,
    extra = lookup.findExtra ? " " + lookup.findExtra : "";
  const values = [
    lookup.projectsRootTmpl,
    "SKILLED_SESSION_WS",
    "SKILLED_SESSION_WSKEY",
    "SKILLED_SESSION_CWD_MARKERS",
    windows ? "-qiFf" : "-qFf",
    windows ? "tolower(n)==tolower(key)" : "n==key",
    depth,
    extra,
    depth + 1,
    extra,
    windows
      ? 'if [ -n "$best" ]; then cygpath -w "$best" 2>/dev/null || printf %s "$best"; fi'
      : 'printf %s "$best"',
  ];
  let index = 0;
  return lookupTemplate.replace(/%%|%[sd]/g, (m) =>
    m === "%%" ? "%" : String(values[index++]),
  );
}
export const buildWindowsSessionLookupScript = (
  lookup: AgentSessionLookup,
): string => buildSessionLookupScript(lookup, true);
export async function findAgentSessionJSONL(
  rt: Runtime,
  lookup: AgentSessionLookup,
  opts: ExecOptions = {},
): Promise<string> {
  const workspace = await workspaceForRuntime(rt),
    key = canonicalWorkspaceKey(workspace);
  if (!key) return "";
  debugf("agent session lookup: workspace=%s key=%s", workspace, key);
  try {
    const result = await rt.exec(
      buildSessionLookupScript(lookup, rt.shell().goos === "windows"),
      {
        ...opts,
        env: {
          SKILLED_SESSION_WS: workspace,
          SKILLED_SESSION_WSKEY: key,
          SKILLED_SESSION_CWD_MARKERS:
            workspaceCwdMarkers(workspace).join("\n"),
        },
      },
    );
    const found = result.stdout.trim();
    if (result.exitCode !== 0 || !found.endsWith(".jsonl")) return "";
    return found;
  } catch {
    return "";
  }
}
export async function withDownloadedSession(
  rt: Runtime,
  artifactDir: string,
  sessionFilePath: string,
  generatedFiles: string[],
  apply: (path: string) => void | Promise<void>,
  opts: ExecOptions = {},
): Promise<{ files: string[]; cleanup: () => Promise<void> }> {
  const noCleanup = async () => {};
  if (!sessionFilePath) return { files: generatedFiles, cleanup: noCleanup };
  const downloaded = await downloadSessionArtifact(
    rt,
    artifactDir,
    sessionFilePath,
    opts.signal,
  );
  if (!downloaded.ok) return { files: generatedFiles, cleanup: noCleanup };
  const files = downloaded.registeredPath
    ? [...generatedFiles, downloaded.registeredPath]
    : generatedFiles;
  try {
    await apply(downloaded.artifactPath);
  } catch (e) {
    await downloaded.cleanup();
    throw e;
  }
  return { files, cleanup: downloaded.cleanup };
}
