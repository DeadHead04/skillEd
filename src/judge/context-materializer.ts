// Modified for the skilled TypeScript distribution.
import { mkdtemp, rm, mkdir, writeFile, open } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Runtime } from "../runtime/types.js";
import type {
  JudgeContextConfig,
  JudgeContextAttachment,
} from "../contracts/schema.js";
import type { Transcript } from "../contracts/transcript.js";
import { infof } from "../logging/index.js";
import {
  resolveInput,
  type Input,
  type MaterializedContext,
  type ContextMaterial,
  type ContextMaterialManifest,
} from "./types.js";
export const defaultJudgeContextMaxBytes = 64 * 1024,
  judgeContextArtifactDir = "judge/context";
export interface EffectiveJudgeContext {
  profile: string;
  finalMessageMode: string;
  transcriptMode: string;
  workspaceDiffMode: string;
  generatedFilesMode: string;
  maxBytes: number;
  transcriptMaxTurns: number;
  workspaceDiffMaxLines: number;
  attachments: JudgeContextAttachment[];
}
export function resolveJudgeContext(
  cfg: JudgeContextConfig | null | undefined,
): EffectiveJudgeContext {
  const profile = cfg?.profile || "standard";
  const r: EffectiveJudgeContext = {
    profile,
    maxBytes: defaultJudgeContextMaxBytes,
    finalMessageMode: profile === "minimal" ? "truncate" : "include",
    transcriptMode: profile === "minimal" ? "omit" : "file_ref",
    workspaceDiffMode: profile === "minimal" ? "omit" : "file_ref",
    generatedFilesMode: profile === "minimal" ? "omit" : "index",
    transcriptMaxTurns: 0,
    workspaceDiffMaxLines: 0,
    attachments: [],
  };
  if (!cfg) return r;
  r.finalMessageMode = cfg.final_message || r.finalMessageMode;
  r.transcriptMode = cfg.transcript || r.transcriptMode;
  r.workspaceDiffMode = cfg.workspace_diff || r.workspaceDiffMode;
  r.generatedFilesMode = cfg.generated_files || r.generatedFilesMode;
  if (cfg.limits) {
    if (cfg.limits.max_bytes > 0) r.maxBytes = cfg.limits.max_bytes;
    r.transcriptMaxTurns = cfg.limits.transcript_max_turns;
    r.workspaceDiffMaxLines = cfg.limits.workspace_diff_max_lines;
  }
  r.attachments = [...(cfg.attachments ?? [])];
  return r;
}
export const contextArchiveDir = (input: Input) =>
  input.contextArtifactDir || judgeContextArtifactDir;
export async function judgeContextHostDir(
  artifactDir: string,
): Promise<string> {
  return artifactDir
    ? path.join(path.dirname(artifactDir), "context")
    : mkdtemp(path.join(os.tmpdir(), "skilled-judge-context-"));
}
export async function materializeJudgeContext(
  rt: Runtime | null,
  cfg: JudgeContextConfig | null | undefined,
  input: Input,
  artifactDir: string,
  signal?: AbortSignal,
): Promise<MaterializedContext> {
  const i = resolveInput(input),
    effective = resolveJudgeContext(cfg),
    hostDir = await judgeContextHostDir(artifactDir);
  await rm(hostDir, { recursive: true, force: true });
  await mkdir(hostDir, { recursive: true, mode: 0o755 });
  const runtimeDir = rt?.workspace().trim()
    ? path.join(rt.workspace(), ".skilled/judge/context")
    : ".skilled/judge/context";
  const mc: MaterializedContext = {
    dir: hostDir,
    runtimeDir,
    manifest: {
      profile: effective.profile,
      materialized_dir: contextArchiveDir(i),
      materials: [],
    },
    materials: [],
  };
  await materializeText(
    rt,
    mc,
    "final_message",
    "final_message.txt",
    i.finalMessage,
    effective.finalMessageMode,
    effective.maxBytes,
    signal,
  );
  await materializeText(
    rt,
    mc,
    "transcript",
    "transcript.json",
    marshalTranscript(i.transcript, effective.transcriptMaxTurns),
    effective.transcriptMode,
    effective.maxBytes,
    signal,
  );
  await materializeText(
    rt,
    mc,
    "workspace_diff",
    "workspace.diff",
    limitLines(i.workspaceDiff, effective.workspaceDiffMaxLines),
    effective.workspaceDiffMode,
    effective.maxBytes,
    signal,
  );
  await materializeGeneratedFiles(
    rt,
    mc,
    i.generatedFiles,
    effective.generatedFilesMode,
    effective.maxBytes,
    signal,
  );
  await materializeAttachments(rt, mc, effective.attachments, i, signal);
  const manifest = path.join(hostDir, "manifest.json");
  await writeFile(manifest, JSON.stringify(mc.manifest, null, 2) + "\n", {
    mode: 0o600,
  });
  await uploadRuntimeFile(
    rt,
    manifest,
    path.join(runtimeDir, "manifest.json"),
    signal,
  );
  infof(
    "judge context materialized profile=%s dir=%s",
    effective.profile,
    hostDir,
  );
  return mc;
}
function manifestOnly(m: ContextMaterial): ContextMaterialManifest {
  const { inlineContent: _, runtimePath: __, ...entry } = m;
  for (const [key, value] of Object.entries(entry))
    if (
      key !== "bytes" &&
      (value === "" || value === false || value === 0 || value == null)
    )
      delete (entry as unknown as Record<string, unknown>)[key];
  return entry;
}
export async function materializeText(
  rt: Runtime | null,
  mc: MaterializedContext,
  key: string,
  fileName: string,
  content: string,
  mode: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<void> {
  mode ||= "file_ref";
  const material: ContextMaterial = {
    key,
    mode,
    bytes: Buffer.byteLength(content),
    original_bytes: Buffer.byteLength(content),
    inlineContent: "",
    runtimePath: "",
  };
  if (!content.trim() && mode !== "omit") mode = material.mode = "omit";
  if (mode === "omit") {
    material.bytes = 0;
    delete material.original_bytes;
    mc.manifest.materials.push(manifestOnly(material));
    return;
  }
  if (mode === "include" && Buffer.byteLength(content) > maxBytes)
    mode = material.mode = "file_ref";
  const saved = await writeMaterialFile(rt, mc, fileName, content, signal);
  material.path = saved.manifestPath;
  material.runtimePath = saved.runtimePath;
  if (mode === "include") material.inlineContent = content;
  else if (mode === "truncate") {
    material.inlineContent = truncateBytes(content, maxBytes);
    material.bytes =
      maxBytes > 0
        ? Math.min(Buffer.byteLength(content), maxBytes)
        : Buffer.byteLength(content);
    material.truncated = material.bytes < (material.original_bytes ?? 0);
  } else if (mode !== "file_ref")
    throw new Error(
      `unsupported judge context mode ${JSON.stringify(mode)} for ${key}`,
    );
  mc.manifest.materials.push(manifestOnly(material));
  mc.materials.push(material);
}
export async function writeMaterialFile(
  rt: Runtime | null,
  mc: MaterializedContext,
  fileName: string,
  content: string,
  signal?: AbortSignal,
): Promise<{ runtimePath: string; manifestPath: string }> {
  const name = safeMaterialRelPath(fileName),
    host = safeMaterialHostPath(mc.dir, name);
  await mkdir(path.dirname(host), { recursive: true, mode: 0o755 });
  await writeFile(host, content, { mode: 0o600 });
  const runtimePath = materialRuntimePath(mc, name);
  await uploadRuntimeFile(rt, host, runtimePath, signal);
  return { runtimePath, manifestPath: materialManifestPath(mc, name) };
}
export async function copyMaterialFile(
  rt: Runtime | null,
  mc: MaterializedContext,
  fileName: string,
  source: string,
  signal?: AbortSignal,
): Promise<{ runtimePath: string; manifestPath: string; bytes: number }> {
  const name = safeMaterialRelPath(fileName),
    host = safeMaterialHostPath(mc.dir, name);
  await mkdir(path.dirname(host), { recursive: true, mode: 0o755 });
  const src = await open(source, "r");
  let dst;
  let bytes = 0;
  try {
    dst = await open(host, "w", 0o600);
    const buffer = Buffer.alloc(64 * 1024);
    for (;;) {
      const read = await src.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      let written = 0;
      while (written < read.bytesRead)
        written += (await dst.write(buffer, written, read.bytesRead - written))
          .bytesWritten;
      bytes += read.bytesRead;
    }
  } finally {
    await dst?.close();
    await src.close();
  }
  const runtimePath = materialRuntimePath(mc, name);
  await uploadRuntimeFile(rt, host, runtimePath, signal);
  return { runtimePath, manifestPath: materialManifestPath(mc, name), bytes };
}
export const materialRuntimePath = (mc: MaterializedContext, name: string) =>
  path.join(mc.runtimeDir, name.split(path.sep).join("/"));
export const materialManifestPath = (mc: MaterializedContext, name: string) =>
  path.posix.join(
    mc.manifest.materialized_dir ?? "",
    name.split(path.sep).join("/"),
  );
export function safeMaterialRelPath(fileName: string): string {
  const clean = path.normalize(fileName);
  if (
    !fileName ||
    path.isAbsolute(fileName) ||
    clean === "." ||
    clean === ".." ||
    clean.startsWith(".." + path.sep)
  )
    throw new Error(
      `invalid judge context material path ${JSON.stringify(fileName)}`,
    );
  return clean;
}
export function safeMaterialHostPath(root: string, rel: string): string {
  const host = path.normalize(path.join(root, rel));
  if (!isWithin(host, path.normalize(root)))
    throw new Error(
      `judge context material path escapes context dir: ${JSON.stringify(rel)}`,
    );
  return host;
}
export async function uploadRuntimeFile(
  rt: Runtime | null,
  host: string,
  runtimePath: string,
  signal?: AbortSignal,
): Promise<void> {
  if (rt)
    try {
      await rt.uploadFile(host, runtimePath, signal);
    } catch (e) {
      throw new Error(
        `upload judge context file ${path.basename(host)}: ${(e as Error).message}`,
        { cause: e },
      );
    }
}
export async function materializeGeneratedFiles(
  rt: Runtime | null,
  mc: MaterializedContext,
  files: string[],
  mode: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<void> {
  mode ||= "index";
  if (mode === "omit" || !files.length) {
    mc.manifest.materials.push({
      key: "generated_files",
      mode: "omit",
      bytes: 0,
    });
    return;
  }
  const content = files.join("\n") + "\n";
  await materializeText(
    rt,
    mc,
    "generated_files",
    "generated_files.txt",
    content,
    mode === "include" && Buffer.byteLength(content) <= maxBytes
      ? "include"
      : "file_ref",
    maxBytes,
    signal,
  );
}
export async function materializeAttachments(
  rt: Runtime | null,
  mc: MaterializedContext,
  attachments: JudgeContextAttachment[],
  input: Input,
  signal?: AbortSignal,
): Promise<void> {
  for (const [i, a] of attachments.entries()) {
    const source = resolveAttachmentPath(a.path, input),
      label = a.label || path.basename(source, path.extname(source)),
      name = `${String(i + 1).padStart(2, "0")}-${safeMaterialName(label)}${path.extname(source)}`;
    const saved = await copyMaterialFile(
      rt,
      mc,
      path.join("attachments", name),
      source,
      signal,
    );
    const m: ContextMaterial = {
      key: "attachment",
      label,
      mode: "file_ref",
      path: saved.manifestPath,
      bytes: saved.bytes,
      original_bytes: saved.bytes,
      runtimePath: saved.runtimePath,
      inlineContent: "",
    };
    mc.manifest.materials.push(manifestOnly(m));
    mc.materials.push(m);
  }
}
export function resolveAttachmentPath(raw: string, input: Input): string {
  const i = resolveInput(input),
    abs = path.resolve(path.isAbsolute(raw) ? raw : path.join(i.skillDir, raw));
  if (
    [i.skillDir, i.workspacePath].some((r) => r && isWithin(abs, r)) ||
    (!i.skillDir && !i.workspacePath)
  )
    return abs;
  throw new Error(
    `judge context attachment ${JSON.stringify(raw)} must stay within skill_dir or workspace`,
  );
}
export function isWithin(file: string, root: string): boolean {
  const rel = path.relative(path.resolve(root), file);
  return !rel || (rel !== ".." && !rel.startsWith(".." + path.sep));
}
export function marshalTranscript(
  transcript: Transcript,
  maxTurns: number,
): string {
  if (!transcript.length) return "";
  return JSON.stringify(
    maxTurns > 0 && transcript.length > maxTurns
      ? transcript.slice(-maxTurns)
      : transcript,
    null,
    2,
  );
}
export function limitLines(value: string, maxLines: number): string {
  if (maxLines <= 0 || !value) return value;
  const lines = value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  return lines.length <= maxLines ? value : lines.slice(0, maxLines).join("");
}
export function truncateBytes(value: string, maxBytes: number): string {
  return maxBytes <= 0 || Buffer.byteLength(value) <= maxBytes
    ? value
    : Buffer.from(value).subarray(0, maxBytes).toString();
}
export function safeMaterialName(value: string): string {
  let result = "";
  for (const c of value.toLowerCase())
    if (/[\p{L}\p{Nd}]/u.test(c)) result += c;
    else if (result) result += "-";
  return result.replace(/^-+|-+$/g, "") || "attachment";
}
