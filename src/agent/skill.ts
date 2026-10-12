// Modified for the skilled TypeScript distribution.
import { lstat, stat, realpath, readdir } from "node:fs/promises";
import path from "node:path";
import { validateGlob } from "../config/validator.js";
import { NoneRuntime } from "../runtime/none.js";
import type { Runtime } from "./types.js";
import { assertSkillSelection, createSkillManifest, verifyInstalledSkill } from "../skill/integrity.js";
// Pattern matching below is translated from doublestar/v4 match.go.
// Copyright (c) 2014 Bob Matcuk. MIT License:
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
function altParts(
  pattern: string[],
  at: number,
): { end: number; parts: string[][] } {
  let nesting = 1,
    start = at + 1;
  const parts: string[][] = [];
  for (let i = start; i < pattern.length; i++) {
    if (pattern[i] === "\\") {
      i++;
      continue;
    }
    if (pattern[i] === "[") {
      while (++i < pattern.length) {
        if (pattern[i] === "\\") i++;
        else if (pattern[i] === "]") break;
      }
      continue;
    }
    if (pattern[i] === "{") nesting++;
    else if (pattern[i] === "}" && --nesting === 0) {
      parts.push(pattern.slice(start, i));
      return { end: i, parts };
    } else if (pattern[i] === "," && nesting === 1) {
      parts.push(pattern.slice(start, i));
      start = i + 1;
    }
  }
  throw new Error("invalid skill file pattern");
}
function zeroLength(pattern: string[]): boolean {
  if (["", "*", "**", "/**", "**/", "/**/"].includes(pattern.join("")))
    return true;
  if (pattern[0] === "{") {
    const { end, parts } = altParts(pattern, 0);
    return parts.some((part) =>
      zeroLength([...part, ...pattern.slice(end + 1)]),
    );
  }
  return false;
}
function goGlobMatch(
  p: string[],
  n: string[],
  pi = 0,
  ni = 0,
  doubleP = -1,
  doubleN = -1,
  starP = -1,
  starN = -1,
): boolean {
  let startOfSegment = true;
  match: while (ni < n.length) {
    if (pi < p.length) {
      switch (p[pi]) {
        case "*": {
          pi++;
          if (p[pi] === "*") {
            pi++;
            if (startOfSegment) {
              if (pi >= p.length) return true;
              if (p[pi] === "/") {
                pi++;
                doubleP = pi;
                doubleN = ni;
                starP = starN = -1;
                continue;
              }
            }
          }
          startOfSegment = false;
          starP = pi;
          starN = ni;
          continue;
        }
        case "?":
          startOfSegment = false;
          if (n[ni] === "/") break;
          pi++;
          ni++;
          continue;
        case "[": {
          startOfSegment = false;
          pi++;
          const negate = p[pi] === "!" || p[pi] === "^";
          if (negate) pi++;
          let matched = false,
            last = 0x10ffff;
          while (pi < p.length && p[pi] !== "]") {
            let rune = p[pi++];
            if (
              last < 0x10ffff &&
              rune === "-" &&
              pi < p.length &&
              p[pi] !== "]"
            ) {
              if (p[pi] === "\\") pi++;
              rune = p[pi++];
              if (
                last <= n[ni].codePointAt(0)! &&
                n[ni].codePointAt(0)! <= rune.codePointAt(0)!
              ) {
                matched = true;
                break;
              }
              last = 0x10ffff;
              continue;
            }
            if (rune === "\\") rune = p[pi++];
            if (rune === n[ni]) {
              matched = true;
              break;
            }
            last = rune.codePointAt(0)!;
          }
          if (matched === negate) break;
          while (pi < p.length && p[pi] !== "]") {
            if (p[pi] === "\\") pi++;
            pi++;
          }
          pi++;
          ni++;
          continue;
        }
        case "{": {
          const { end, parts } = altParts(p, pi);
          return parts.some((part) =>
            goGlobMatch(
              [...p.slice(0, pi), ...part, ...p.slice(end + 1)],
              n,
              pi,
              ni,
              doubleP,
              doubleN,
              starP,
              starN,
            ),
          );
        }
        default: {
          const escaped = p[pi] === "\\";
          if (escaped) pi++;
          if (p[pi] !== n[ni]) {
            if (escaped) pi--;
            break;
          }
          startOfSegment = p[pi] === "/";
          pi++;
          ni++;
          continue;
        }
      }
    }
    if (starP >= 0 && starN < n.length && n[starN] !== "/") {
      starN++;
      pi = starP;
      ni = starN;
      startOfSegment = false;
      continue;
    }
    if (doubleP >= 0) {
      ni = doubleN;
      while (ni < n.length) {
        if (n[ni++] === "/") {
          doubleN = ni;
          pi = doubleP;
          startOfSegment = true;
          continue match;
        }
      }
    }
    return false;
  }
  return zeroLength(p.slice(pi));
}
export function matchSkillPattern(pattern: string, relative: string): boolean {
  if (!validateGlob(pattern))
    throw new Error(`invalid skill file pattern ${JSON.stringify(pattern)}`);
  return goGlobMatch(Array.from(pattern), Array.from(relative));
}

export function matchesSkillPatterns(
  patterns: string[],
  relative: string,
): boolean {
  return patterns.some((p) => matchSkillPattern(p, relative));
}
export function matchesSkillDirectory(
  patterns: string[],
  relative: string,
): boolean {
  return patterns.some(
    (p) => p.endsWith("/**") && matchSkillPattern(p.slice(0, -3), relative),
  );
}
export async function listSkillFiles(
  sourceDir: string,
  include: string[] = [],
  exclude: string[] = [],
): Promise<string[]> {
  for (const pattern of [...include, ...exclude])
    if (!validateGlob(pattern))
      throw new Error(`invalid skill file pattern ${JSON.stringify(pattern)}`);
  let root: string;
  try {
    root = await realpath(sourceDir);
  } catch (e) {
    throw new Error(
      `failed to resolve skill source ${sourceDir}: ${(e as Error).message}`,
      { cause: e },
    );
  }
  const files: string[] = [];
  async function visit(file: string): Promise<void> {
    const info = await lstat(file);
    const relative = path.relative(root, file) || ".";
    const rel = relative.split(path.sep).join("/");
    if (rel === "evals") return;
    if (
      matchesSkillPatterns(exclude, rel) ||
      (info.isDirectory() && matchesSkillDirectory(exclude, rel))
    )
      return;
    if (info.isDirectory()) {
      files.push(relative);
      for (const child of (await readdir(file)).sort())
        await visit(path.join(file, child));
    } else if (!include.length || matchesSkillPatterns(include, rel))
      files.push(relative);
  }
  await visit(root);
  return files;
}
export async function resolvePotentialInstallPath(
  target: string,
): Promise<string> {
  let current = path.normalize(target);
  const missing: string[] = [];
  for (;;) {
    try {
      await lstat(current);
      let resolved = await realpath(current);
      for (const part of missing.reverse())
        resolved = path.join(resolved, part);
      return path.normalize(resolved);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const next = path.dirname(current);
    if (next === current) return target;
    missing.push(path.basename(current));
    current = next;
  }
}
export async function relativePathByIdentity(
  parent: string,
  child: string,
): Promise<string | undefined> {
  let parentInfo;
  try {
    parentInfo = await stat(parent);
  } catch {
    return undefined;
  }
  let current = path.normalize(child);
  const parts: string[] = [];
  for (;;) {
    try {
      const info = await stat(current);
      if (parentInfo.dev === info.dev && parentInfo.ino === info.ino)
        return parts.length ? path.join(...parts.reverse()) : ".";
    } catch {}
    const next = path.dirname(current);
    if (next === current) return undefined;
    parts.push(path.basename(current));
    current = next;
  }
}
export function installTargetExclusions(
  exclude: string[],
  relative: string,
): { exclude: string[]; alreadyInstalled: boolean } {
  if (relative === ".") return { exclude, alreadyInstalled: true };
  relative = relative.split(path.sep).join("/");
  return {
    exclude: [...exclude, ".git", ".git/**", relative, relative + "/**"],
    alreadyInstalled: false,
  };
}
export async function excludeInstallTarget(
  workspace: string,
  source: string,
  target: string,
  exclude: string[],
): Promise<{ exclude: string[]; alreadyInstalled: boolean }> {
  let sourcePath = path.resolve(source);
  try {
    sourcePath = await realpath(sourcePath);
  } catch {}
  let targetPath = path.normalize(target);
  if (!path.isAbsolute(targetPath))
    targetPath = path.join(await realpath(workspace), targetPath);
  targetPath = path.resolve(targetPath);
  try {
    targetPath = await resolvePotentialInstallPath(targetPath);
  } catch {}
  const identity = await relativePathByIdentity(sourcePath, targetPath);
  if (identity !== undefined) return installTargetExclusions(exclude, identity);
  const relative = path.relative(sourcePath, targetPath);
  if (
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(".." + path.sep)
  )
    return { exclude, alreadyInstalled: false };
  return installTargetExclusions(exclude, relative || ".");
}
export async function installSkill(
  rt: Runtime,
  source: string,
  target: string,
  include: string[] = [],
  exclude: string[] = [],
  signal?: AbortSignal,
): Promise<void> {
  let filtered = exclude;
  if (rt instanceof NoneRuntime) {
    const result = await excludeInstallTarget(
      rt.workspace(),
      source,
      target,
      exclude,
    );
    if (result.alreadyInstalled) {
      await assertSkillSelection(source, await listSkillFiles(source, include, exclude));
      return;
    }
    filtered = result.exclude;
  }
  const files = await listSkillFiles(source, include, filtered);
  const selected: string[] = [];
  for (const file of files)
    if (!(await stat(path.join(source, file))).isDirectory()) selected.push(file);
  if (selected.length === 0)
    throw new Error(
      `skill source ${source} selected 0 files (include=[${include.join(" ")}] exclude=[${exclude.join(" ")}]): refusing to install an empty skill`,
    );
  await assertSkillSelection(source, files);
  const manifest = await createSkillManifest(source, selected, signal);
  for (const entry of manifest)
    await rt.uploadFile(path.join(source, entry.path), path.join(target, entry.path), signal);
  await verifyInstalledSkill(rt, target, manifest, signal);
}
