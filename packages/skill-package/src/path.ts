import fs from "node:fs";
import path from "node:path";
import { ImportSafetyError } from "./errors";

export function workspaceRoot(start = process.cwd()): string {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml")))
      return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

export function resolveWorkspacePath(
  configured: string | undefined,
  fallback: string,
): string {
  const value = configured?.trim() || fallback;
  return path.isAbsolute(value)
    ? path.normalize(value)
    : path.resolve(workspaceRoot(), value);
}

export function normalizePackagePath(input: string, maxDepth: number): string {
  if (!input || input.includes("\0")) {
    throw new ImportSafetyError(
      "UNSAFE_ARCHIVE",
      "Archive contains an invalid path.",
    );
  }

  const slashed = input.replaceAll("\\", "/");
  if (slashed.startsWith("/") || /^[A-Za-z]:\//.test(slashed)) {
    throw new ImportSafetyError(
      "UNSAFE_ARCHIVE",
      "Archive contains an absolute path.",
    );
  }

  const parts = slashed
    .split("/")
    .filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === "..")) {
    throw new ImportSafetyError(
      "UNSAFE_ARCHIVE",
      "Archive path escapes its root.",
    );
  }
  if (parts.length === 0 || parts.length > maxDepth) {
    throw new ImportSafetyError(
      parts.length > maxDepth ? "IMPORT_LIMIT_EXCEEDED" : "UNSAFE_ARCHIVE",
      "Archive path depth is invalid.",
    );
  }

  return parts.join("/");
}

export function resolveInside(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(root, ...relativePath.split("/"));
  if (
    target !== resolvedRoot &&
    !target.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new ImportSafetyError(
      "UNSAFE_ARCHIVE",
      "Resolved path escapes its root.",
    );
  }
  return target;
}
