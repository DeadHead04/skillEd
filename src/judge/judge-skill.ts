// Modified for the skilled TypeScript distribution.
import path from "node:path";
import type { SkillRef } from "../contracts/schema.js";
import type { SkillInfo } from "./types.js";
export function skillInfoName(value: string): string {
  const clean = path.normalize(value);
  return clean === "." ? "" : path.basename(clean);
}
export function skillInfosFromRefs(
  refs: SkillRef[] | null | undefined,
): SkillInfo[] {
  return (refs ?? []).map((r) => ({
    ...(r.source ? { source: r.source } : {}),
    ...(r.path ? { path: r.path } : {}),
    ...(r.target ? { target: r.target } : {}),
    ...(r.include.length ? { include: [...r.include] } : {}),
    ...(r.exclude.length ? { exclude: [...r.exclude] } : {}),
    ...(skillInfoName(r.path) ? { name: skillInfoName(r.path) } : {}),
  }));
}
