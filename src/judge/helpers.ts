// Modified for the skilled TypeScript distribution.
import path from "node:path";
import { stat } from "node:fs/promises";
export const quote = JSON.stringify;
export const list = (v: unknown[]) => "[" + v.map(goFormat).join(" ") + "]";
export function goFormat(v: unknown): string {
  if (v == null) return "<nil>";
  if (Array.isArray(v)) return list(v);
  if (typeof v === "object")
    return (
      "map[" +
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => k + ":" + goFormat(v))
        .join(" ") +
      "]"
    );
  return String(v);
}
export function safePath(workspace: string, relative: string): string {
  const clean = path.normalize(path.join(workspace, relative));
  const root = path.normalize(workspace);
  if (clean === root || clean.startsWith(root + path.sep)) return clean;
  throw new Error(`path ${quote(relative)} escapes workspace`);
}
export async function fileExistsInWorkspace(
  workspace: string,
  relative: string,
): Promise<boolean> {
  const target = safePath(workspace, relative);
  try {
    await stat(target);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e);
