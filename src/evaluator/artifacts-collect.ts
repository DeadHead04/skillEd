// Modified for the skilled TypeScript distribution.
import * as fs from "node:fs/promises";
import path from "node:path";
import type { EvalConfig, CaseConfig } from "../contracts/schema.js";
import type { Runtime } from "../runtime/types.js";
import { matchSkillPattern } from "../agent/skill.js";
import { warnf } from "../logging/index.js";
export function resolveCollectArtifacts(
  evalCfg?: EvalConfig,
  caseCfg?: CaseConfig,
): string[] {
  return [
    ...new Set(
      [
        ...(evalCfg?.cases.defaults.collect_artifacts ?? []),
        ...(caseCfg?.collect_artifacts ?? []),
      ]
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
export async function listWorkspaceFiles(
  rt: Runtime,
  signal?: AbortSignal,
): Promise<string[]> {
  const result = await rt.exec("find . -type f -not -path './.git/*'", {
    cwd: rt.workspace(),
    signal,
  });
  return result.stdout
    .split("\n")
    .map((v) => v.trim().replace(/^\.\//, ""))
    .filter(Boolean);
}
export function matchesAnyGlob(patterns: string[], relative: string): boolean {
  return patterns.some((p) => {
    try {
      return matchSkillPattern(p, relative);
    } catch {
      return false;
    }
  });
}
export function safeOutputPath(
  outputDir: string,
  caseID: string,
  configName: string,
  subpath: string,
): string {
  const root = path.resolve(outputDir),
    target = path.resolve(root, caseID, configName, "outputs", subpath);
  if (target === root || !target.startsWith(root + path.sep))
    throw new Error("artifact output path escapes output directory");
  return target;
}
export async function collectGlobArtifacts(
  outputDir: string,
  evalCfg: EvalConfig,
  rt: Runtime,
  configName: string,
  cfg: CaseConfig,
): Promise<void> {
  const patterns = resolveCollectArtifacts(evalCfg, cfg);
  if (!patterns.length || !outputDir || !configName || !cfg.id) return;
  const signal = AbortSignal.timeout(60_000);
  try {
    const files = await listWorkspaceFiles(rt, signal),
      root = safeOutputPath(outputDir, cfg.id, configName, "workspace");
    try {
      await fs.rm(root, { recursive: true, force: true });
    } catch (e) {
      warnf(
        "Evaluator: collect_artifacts: failed to clear %s: %s",
        root,
        String(e),
      );
    }
    for (const relative of files) {
      if (!matchesAnyGlob(patterns, relative)) continue;
      const target = path.resolve(root, relative);
      if (!target.startsWith(root + path.sep)) continue;
      try {
        await rt.downloadFile(relative, target, signal);
      } catch (e) {
        warnf(
          "Evaluator: collect_artifacts: failed to download %s: %s",
          relative,
          String(e),
        );
      }
    }
  } catch (e) {
    warnf(
      "Evaluator: collect_artifacts: failed to list workspace for case %s: %s",
      cfg.id,
      String(e),
    );
  }
}
