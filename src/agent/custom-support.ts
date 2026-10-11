// Modified for the skilled TypeScript distribution.
import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  parseTemplateToken,
  requiredError,
} from "../contracts/customengine.js";
import type { Message, Transcript } from "../contracts/transcript.js";
import type { Runtime, ArtifactFile } from "./types.js";
export const customDefaultInputFile = "inputs/messages.json";
export const customDefaultOutputFile = "outputs/session-result.json";
export const customStaleClearedMarker = "__skilled_stale_output_cleared__";
export const customArtifactReadTimeoutMs = 30_000;
export const maxInlineArtifactBytes = 50 * 1024 * 1024;
export const maxInlineArtifactTotal = 200 * 1024 * 1024;
export const maxHTTPResponseBytes = 64 * 1024 * 1024;
export const maxArtifactDownloadBytes = 256 * 1024 * 1024;
export function renderTemplate(
  s: string,
  vars: Record<string, string>,
): string {
  return s.replace(/\$\{([^}]*)\}/g, (_whole, inner: string) =>
    resolveTemplateToken(inner, vars),
  );
}
export function resolveTemplateToken(
  inner: string,
  vars: Record<string, string>,
): string {
  const t = parseTemplateToken(inner);
  if (Object.hasOwn(vars, t.name)) {
    const value = vars[t.name];
    if (value || (!t.hasDefault && !t.hasErrForm)) return value;
  }
  if (process.env[t.name]) return process.env[t.name]!;
  if (t.hasDefault) return t.default;
  if (t.hasErrForm) throw requiredError(t);
  if (t.name.startsWith("kwargs.")) return "";
  throw new Error(`unresolved template variable ${JSON.stringify(t.name)}`);
}
export function renderTemplateMap(
  m: Record<string, string>,
  vars: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(m).map(([k, v]) => {
      try {
        return [k, renderTemplate(v, vars)];
      } catch (e) {
        throw new Error(`${k}: ${(e as Error).message}`, { cause: e });
      }
    }),
  );
}
export function singleTurnPrompt(messages: Message[]): string {
  return messages.length === 1 && messages[0].role === "user"
    ? (messages[0].content ?? "")
    : "";
}
export function deriveTurns(trans: Transcript): number {
  const max = Math.max(0, ...trans.map((m) => m.turn ?? 0));
  return max || trans.filter((m) => m.role === "assistant").length;
}
export function minimalCustomTranscript(
  messages: Message[],
  finalMessage: string,
): Transcript {
  const trans = messages.map((m) => ({ ...m }));
  if (finalMessage)
    trans.push({
      role: "assistant",
      content: finalMessage,
      turn: Math.max(1, ...messages.map((m) => m.turn ?? 0)),
    });
  return trans;
}
export async function resolveExistingPrefix(absolute: string): Promise<string> {
  let suffix = "",
    current = absolute;
  for (;;) {
    try {
      const resolved = await realpath(current);
      return suffix ? path.join(resolved, suffix) : resolved;
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) return absolute;
    suffix = path.join(path.basename(current), suffix);
    current = parent;
  }
}
export async function workspacePath(rt: Runtime, p: string): Promise<string> {
  if (!p) return "";
  let workspace = path.normalize(rt.workspace());
  try {
    workspace = await realpath(workspace);
  } catch {}
  const absolute = path.isAbsolute(p)
    ? path.normalize(p)
    : path.join(workspace, p);
  const resolved = await resolveExistingPrefix(absolute);
  const relative = path.relative(workspace, resolved);
  if (
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(".." + path.sep)
  )
    throw new Error(`path ${JSON.stringify(p)} escapes the runtime workspace`);
  return resolved;
}
export function validateArtifactFiles(files: ArtifactFile[]): void {
  let total = 0;
  for (const [i, f] of files.entries()) {
    if (!f.name?.trim())
      throw new Error(`artifacts.files[${i}]: name is required`);
    const count = [f.path, f.url, f.content, f.content_base64].filter(
      Boolean,
    ).length;
    if (count !== 1)
      throw new Error(
        `artifacts.files[${i}] (${JSON.stringify(f.name)}): must set exactly one of path/url/content/content_base64 (got ${count})`,
      );
    const size = f.content
      ? Buffer.byteLength(f.content)
      : f.content_base64
        ? Math.floor((Buffer.byteLength(f.content_base64) * 3) / 4)
        : 0;
    if (size > maxInlineArtifactBytes)
      throw new Error(
        `artifacts.files[${i}] (${JSON.stringify(f.name)}): inline content size ${size} exceeds per-file limit ${maxInlineArtifactBytes}`,
      );
    total += size;
    if (total > maxInlineArtifactTotal)
      throw new Error(
        `artifacts.files: total inline content size exceeds ${maxInlineArtifactTotal} bytes after entry ${i} (${JSON.stringify(f.name)})`,
      );
  }
}
export function decodeBase64(value: string): Buffer {
  const stripped = value.replace(/[\r\n]/g, "");
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      stripped,
    )
  )
    throw new Error("illegal base64 data");
  return Buffer.from(stripped, "base64");
}
export async function readLimitedResponse(
  response: Response,
  limit: number,
): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw new Error(`response exceeded ${limit} bytes`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, total);
  } finally {
    reader.releaseLock();
  }
}
export function combinedSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal | undefined {
  if (timeoutMs <= 0) return signal;
  const timeout = AbortSignal.timeout(Math.ceil(timeoutMs));
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
export function isDeadlineError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as Error;
  return (
    e.name === "TimeoutError" ||
    /deadline exceeded|timed? ?out/i.test(e.message) ||
    (e.cause !== undefined && isDeadlineError(e.cause))
  );
}
