// Modified for the skilled TypeScript distribution.
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Runtime } from "./types.js";
import type { HTTPFile } from "../contracts/schema.js";
import { workspaceRelPathSafe } from "../contracts/customengine.js";
import { validateGlob } from "../config/validator.js";
import { matchSkillPattern } from "./skill.js";
export const maxHTTPUploadBytes = 256 * 1024 * 1024;
export async function listWorkspaceFiles(
  rt: Runtime,
  signal?: AbortSignal,
): Promise<string[]> {
  const result = await rt.exec("find . -type f -not -path './.git/*' -print0", {
    cwd: rt.workspace(),
    signal,
  });
  return result.stdout
    .split("\0")
    .map((s) => (s.startsWith("./") ? s.slice(2) : s))
    .filter((s) => s && workspaceRelPathSafe(s) && !/[\r\n]/.test(s));
}
export const isGlobPattern = (p: string) => /[*?\[]/.test(p);
export async function expandHTTPFiles(
  rt: Runtime,
  files: HTTPFile[],
  signal?: AbortSignal,
): Promise<string[]> {
  const listing = await listWorkspaceFiles(rt, signal);
  const present = new Set(listing),
    out = new Set<string>();
  for (const [i, f] of files.entries()) {
    if (!workspaceRelPathSafe(f.path))
      throw new Error(
        `engine.custom.http.files[${i}].path ${JSON.stringify(f.path)} must be a non-empty relative path inside the workspace`,
      );
    const pattern = f.path.startsWith("./") ? f.path.slice(2) : f.path;
    let matches: string[] = [];
    if (isGlobPattern(pattern)) {
      for (const rel of listing) {
        if (!validateGlob(pattern))
          throw new Error(
            `engine.custom.http.files[${i}].path ${JSON.stringify(f.path)}: invalid glob`,
          );
        if (matchSkillPattern(pattern, rel)) matches.push(rel);
      }
    } else if (present.has(pattern)) matches = [pattern];
    if (!matches.length) {
      if (f.required !== false)
        throw new Error(
          `engine.custom.http.files[${i}]: ${JSON.stringify(f.path)} matched no files in the workspace`,
        );
      continue;
    }
    for (const m of matches) out.add(m);
  }
  return [...out].sort();
}
export async function buildMultipartBody(
  rt: Runtime,
  files: HTTPFile[],
  payload: string,
  signal?: AbortSignal,
): Promise<FormData> {
  const form = new FormData();
  form.set("payload", payload);
  const paths = await expandHTTPFiles(rt, files, signal);
  let total = 0;
  for (const rel of paths) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "skilled-http-upload-"));
    try {
      const target = path.join(dir, "file");
      await rt.downloadFile(rel, target, signal);
      total += (await stat(target)).size;
      if (total > maxHTTPUploadBytes)
        throw new Error(
          `http.files: total upload exceeds ${maxHTTPUploadBytes} bytes`,
        );
      const bytes = await readFile(target);
      form.append("files", new Blob([bytes]), rel);
    } catch (e) {
      throw new Error(
        `http.files: read ${JSON.stringify(rel)}: ${(e as Error).message}`,
        { cause: e },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  return form;
}
