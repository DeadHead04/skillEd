import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
  lstat,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
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
    const temp = await mkdtemp(join(tmpdir(), "skilled-diff-"));
    try {
      await writeFile(join(temp, "before"), before);
      await writeFile(join(temp, "after"), after);
      let output = "";
      try {
        output = (
          await promisify(execFile)(
            "git",
            [
              "diff",
              "--no-index",
              "--no-ext-diff",
              "--no-textconv",
              "--no-color",
              "--unified=3",
              "--",
              "before",
              "after",
            ],
            {
              cwd: temp,
              timeout: 5000,
              maxBuffer: 2_000_000,
              env: {
                ...process.env,
                GIT_CONFIG_NOSYSTEM: "1",
                GIT_CONFIG_GLOBAL: "/dev/null",
              },
            },
          )
        ).stdout;
      } catch (error) {
        if ((error as any).code !== 1) throw error;
        output = String((error as any).stdout);
      }
      const hunk = output.indexOf("@@");
      const header = `--- ${change.action === "create" ? "/dev/null" : `a/${oldPath}`}\n+++ ${change.action === "delete" ? "/dev/null" : `b/${change.path}`}\n`;
      if (hunk >= 0) patches.push(header + output.slice(hunk));
      else if (change.action === "rename")
        patches.push(`rename from ${oldPath}\nrename to ${change.path}\n`);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
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
