import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { mkdtemp, open, realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import type { Runtime } from "../runtime/types.js";

export interface SkillSourceValidation {
  valid: boolean;
  directory: string;
  errors: string[];
  references: string[];
  name?: string;
  description?: string;
}
export interface SkillFileDigest {
  path: string;
  sha256: string;
}
export const MAX_SKILL_FILE_BYTES = 4 * 1024 * 1024;

async function readSkillDocument(file: string): Promise<string> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("SKILL.md must be a regular file");
    if (info.size > MAX_SKILL_FILE_BYTES) throw new Error("SKILL.md exceeds the 4 MiB read limit");
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_SKILL_FILE_BYTES + 1 - total));
      const { bytesRead } = await handle.read(chunk);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > MAX_SKILL_FILE_BYTES) throw new Error("SKILL.md exceeds the 4 MiB read limit");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { await handle.close(); }
}

function isOutside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return path.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + path.sep);
}

/** Static declarations only: Markdown links and literal bundled paths in inline code.
 * Fenced examples, remote URLs, anchors, templates and glob patterns are not file declarations.
 * This deliberately does not claim to infer dependencies from prose or executable code.
 */
function declaredReferences(markdown: string): string[] {
  const lines: string[] = [];
  let fence: string | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
      continue;
    }
    if (!fence) lines.push(line);
  }
  const text = lines.join("\n");
  const candidates: string[] = [];
  for (const match of text.matchAll(/!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+[^)\n]*)?\)/g))
    candidates.push(match[1] ?? match[2]);
  for (const match of text.matchAll(/^\s{0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+))/gm))
    candidates.push(match[1] ?? match[2]);
  for (const match of text.matchAll(/`((?:\.\/)?(?:references|scripts|assets)\/[^`\n]+)`/g))
    candidates.push(match[1]);
  const references = new Set<string>();
  for (let value of candidates) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) continue;
    value = value.split(/[?#]/, 1)[0];
    try { value = decodeURIComponent(value); } catch { /* Preserve malformed paths for an actionable missing-file error. */ }
    if (!value || /[*{}<>$]/.test(value)) continue;
    references.add(value);
  }
  return [...references].sort();
}

/** Strict metadata validation is opt-in at the CLI; installation accepts legacy metadata-free files. */
export async function validateSkillSource(
  directory: string,
  options: { requireMetadata?: boolean } = {},
): Promise<SkillSourceValidation> {
  const result: SkillSourceValidation = { valid: false, directory: path.resolve(directory), errors: [], references: [] };
  let markdown: string;
  let root: string;
  try {
    root = await realpath(directory);
    if (isOutside(root, await realpath(path.join(root, "SKILL.md")))) throw new Error("SKILL.md resolves outside the Skill directory");
    markdown = await readSkillDocument(path.join(root, "SKILL.md"));
  } catch (error) {
    result.errors.push(`cannot read SKILL.md: ${(error as Error).message}`);
    return result;
  }
  const lines = markdown.replace(/^\uFEFF/, "").split(/\r?\n/);
  let body = markdown;
  if (lines[0]?.trimEnd() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---");
    if (end < 0) result.errors.push("SKILL.md frontmatter is missing its closing --- delimiter");
    else {
      body = lines.slice(end + 1).join("\n");
      try {
        const metadata: unknown = parse(lines.slice(1, end).join("\n"));
        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
          result.errors.push("SKILL.md YAML frontmatter must be a mapping");
        for (const key of ["name", "description"] as const) {
          const value = metadata && typeof metadata === "object" && !Array.isArray(metadata)
            ? (metadata as Record<string, unknown>)[key] : undefined;
          if (value === undefined && options.requireMetadata === false) continue;
          if (typeof value !== "string" || !value.trim()) result.errors.push(`SKILL.md frontmatter ${key} must be a non-empty string`);
          else result[key] = value.trim();
        }
      } catch (error) { result.errors.push(`invalid SKILL.md YAML frontmatter: ${(error as Error).message}`); }
    }
  } else if (options.requireMetadata !== false) {
    result.errors.push("SKILL.md must start with YAML frontmatter containing name and description");
  }
  for (const reference of declaredReferences(body)) {
    const candidate = path.resolve(root, reference);
    if (isOutside(root, candidate)) {
      result.errors.push(`local reference is outside the Skill directory: ${reference}`);
      continue;
    }
    try {
      if (isOutside(root, await realpath(candidate))) {
        result.errors.push(`local reference resolves outside the Skill directory: ${reference}`);
        continue;
      }
      const info = await stat(candidate);
      if (!info.isFile() && !info.isDirectory()) throw new Error("not a regular file or directory");
      result.references.push(path.relative(root, candidate).split(path.sep).join("/"));
    } catch (error) {
      result.errors.push(`missing or unreadable local reference ${reference}: ${(error as Error).message}`);
    }
  }
  result.valid = result.errors.length === 0;
  return result;
}

/** Refuse incomplete selections before creating or changing any installed files. */
export async function assertSkillSelection(source: string, files: string[]): Promise<void> {
  try { await stat(path.join(source, "SKILL.md")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return; // Generic legacy workspace installs remain supported.
    throw error;
  }
  const selected = new Set(files.map((file) => file.split(path.sep).join("/")));
  if (!selected.has("SKILL.md")) throw new Error("Skill installation selection excludes SKILL.md");
  const validation = await validateSkillSource(source, { requireMetadata: false });
  if (!validation.valid) throw new Error(`Skill source validation failed: ${validation.errors.join("; ")}`);
  for (const reference of validation.references) {
    const info = await stat(path.join(source, reference));
    const included = info.isDirectory()
      ? [...selected].some((file) => file.startsWith(reference + "/"))
      : selected.has(reference);
    if (!included) throw new Error(`Skill installation selection excludes declared reference: ${reference}`);
  }
}

async function digest(file: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file, { signal })) hash.update(bytes);
  return hash.digest("hex");
}

export async function createSkillManifest(source: string, files: string[], signal?: AbortSignal): Promise<SkillFileDigest[]> {
  const manifest: SkillFileDigest[] = [];
  for (const file of files) {
    signal?.throwIfAborted();
    const local = path.join(source, file);
    const info = await stat(local);
    if (info.isDirectory()) continue;
    if (!info.isFile()) throw new Error(`Skill source entry must be a regular file: ${file}`);
    manifest.push({ path: file, sha256: await digest(local, signal) });
  }
  return manifest;
}

/** Read back exact installed bytes through the same runtime, including container runtimes. */
export async function verifyInstalledSkill(rt: Runtime, target: string, manifest: SkillFileDigest[], signal?: AbortSignal): Promise<void> {
  const temp = await mkdtemp(path.join(os.tmpdir(), "skilled-integrity-"));
  try {
    for (const entry of manifest) {
      signal?.throwIfAborted();
      const downloaded = path.join(temp, "file");
      await rm(downloaded, { force: true });
      try {
        await rt.downloadFile(path.join(target, entry.path), downloaded, signal);
        if (await digest(downloaded, signal) !== entry.sha256) throw new Error("SHA-256 mismatch");
      } catch (error) {
        throw new Error(`installed Skill integrity check failed for ${entry.path}: ${(error as Error).message}`, { cause: error });
      }
    }
  } finally { await rm(temp, { recursive: true, force: true }); }
}
