import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
  lstat,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { excludedPackagePath, parseSkillMetadata } from "./intake";
export type FileChange = {
  path: string;
  action: "create" | "replace" | "delete" | "rename";
  content?: string;
  from?: string;
};
function safe(root: string, path: string) {
  if (!path || /[\x00-\x1f\\]/.test(path) || excludedPackagePath(path))
    throw new Error(`Unsupported package change path: ${path}`);
  const full = resolve(root, path),
    rel = relative(root, full);
  if (!rel || rel.startsWith("..") || resolve(path) === path)
    throw new Error("Package change escapes root");
  return full;
}
export async function applyFileChanges(root: string, changes: FileChange[]) {
  const seen = new Set<string>();
  for (const change of changes) {
    const target = safe(root, change.path);
    if (seen.has(change.path)) throw new Error("Duplicate change target");
    seen.add(change.path);
    if (change.action === "delete") {
      await lstat(target);
      await rm(target);
    } else if (change.action === "rename") {
      if (!change.from) throw new Error("Rename requires a source path");
      await lstat(target).then(
        () => {
          throw new Error("Rename target already exists");
        },
        (error) => {
          if (error.code !== "ENOENT") throw error;
        },
      );
      await mkdir(dirname(target), { recursive: true });
      await rename(safe(root, change.from), target);
      if (change.content !== undefined) await writeFile(target, change.content);
    } else {
      if (typeof change.content !== "string")
        throw new Error("File content is required");
      if (change.action === "replace") await lstat(target);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, change.content, {
        flag: change.action === "create" ? "wx" : "w",
      });
    }
  }
  return parseSkillMetadata(await readFile(join(root, "SKILL.md"), "utf8"));
}
export async function unifiedFilePatch(root: string, changes: FileChange[]) {
  const patches: string[] = [];
  for (const change of changes) {
    const oldPath = change.action === "rename" ? change.from! : change.path;
    const before =
      change.action === "create"
        ? ""
        : await readFile(safe(root, oldPath), "utf8");
    const after = change.action === "delete" ? "" : (change.content ?? before);
    const lines = (text: string) =>
      text ? text.replace(/\n$/, "").split("\n") : [];
    const old = lines(before),
      next = lines(after);
    patches.push(
      `--- ${change.action === "create" ? "/dev/null" : `a/${oldPath}`}\n+++ ${change.action === "delete" ? "/dev/null" : `b/${change.path}`}\n@@ -${old.length ? 1 : 0},${old.length} +${next.length ? 1 : 0},${next.length} @@\n${old.map((line) => `-${line}\n`).join("")}${next.map((line) => `+${line}\n`).join("")}`,
    );
  }
  return patches.join("\n");
}
export async function packageFiles(
  root: string,
  prefix = "",
): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink())
      throw new Error("Symlinks cannot enter packages");
    if (excludedPackagePath(path)) continue;
    if (entry.isDirectory()) result.push(...(await packageFiles(root, path)));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}
