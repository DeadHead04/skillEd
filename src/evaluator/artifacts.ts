// Modified for the skilled TypeScript distribution.
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Runtime } from "../runtime/types.js";
import type { GitContext } from "../contracts/schema.js";
import type { SessionResult, SessionArtifacts } from "../agent/types.js";
import type { Transcript } from "../contracts/transcript.js";
import { quotePOSIX as shellQuote } from "../platform/index.js";
import { warnf } from "../logging/index.js";
import { safeOutputPath } from "./artifacts-collect.js";
export interface WorkspaceDiffState {
  enabled: boolean;
  baselineRev: string;
  temporaryPath: string;
}
const disabled = (): WorkspaceDiffState => ({
  enabled: false,
  baselineRev: "",
  temporaryPath: "",
});
const unsetGit =
  "unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS\n";
async function checked(
  rt: Runtime,
  cmd: string,
  label: string,
  signal?: AbortSignal,
): Promise<string> {
  const r = await rt.exec(cmd, { cwd: rt.workspace(), signal });
  if (r.exitCode !== 0)
    throw new Error(`${label} exited with code ${r.exitCode}: ${r.stderr}`);
  return r.stdout.trim();
}
export async function prepareWorkspaceDiffState(
  rt: Runtime,
  git: GitContext | null,
  signal?: AbortSignal,
): Promise<WorkspaceDiffState> {
  if (!git?.init) {
    const r = await rt.exec(
      "if git rev-parse --git-dir >/dev/null 2>&1; then printf git; else printf no-git; fi",
      { cwd: rt.workspace(), signal },
    );
    if (r.stdout.trim() !== "git") return disabled();
  }
  const script = `set -eu
if git rev-parse --git-dir >/dev/null 2>&1; then :; else git init -q >/dev/null 2>&1 || exit 0; fi
if ! git config user.name >/dev/null 2>&1; then git config user.name skilled; fi
if ! git config user.email >/dev/null 2>&1; then git config user.email skilled@example.invalid; fi
git add --all
git commit --allow-empty -qm skilled-baseline
git rev-parse HEAD`;
  const baselineRev = await checked(
    rt,
    script,
    "prepare workspace diff state",
    signal,
  );
  return baselineRev
    ? { enabled: true, baselineRev, temporaryPath: "" }
    : disabled();
}
function externalIndexScript(
  rt: Runtime,
  temporaryPath: string,
  initialize: boolean,
): string {
  const config = path.join(temporaryPath, "config");
  return `set -eu
${unsetGit}all_pathspecs=${shellQuote(path.join(temporaryPath, "all-pathspecs"))}
pathspecs=${shellQuote(path.join(temporaryPath, "pathspecs"))}
git -c core.fsmonitor=false ls-files -z --cached --others --exclude-standard -- . > "$all_pathspecs"
xargs -0 sh -c 'for path do
  if [ -e "$path" ] || [ -L "$path" ]; then printf "%s\\0" "$path"; fi
done' sh < "$all_pathspecs" > "$pathspecs"
${initialize ? "git init --bare -q " + shellQuote(path.join(temporaryPath, "repo.git")) + "\n" : ""}export GIT_DIR=${shellQuote(path.join(temporaryPath, "repo.git"))}
export GIT_WORK_TREE=${shellQuote(rt.workspace())}
export GIT_INDEX_FILE=${shellQuote(path.join(temporaryPath, "index"))}
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_SYSTEM=${shellQuote(config)}
export GIT_CONFIG_GLOBAL=${shellQuote(config)}
export GIT_ATTR_NOSYSTEM=1
git read-tree --empty
if [ -s "$pathspecs" ]; then
  git --literal-pathspecs -c advice.addEmbeddedRepo=false add --pathspec-from-file="$pathspecs" --pathspec-file-nul
fi
`;
}
export async function prepareExternalWorkspaceDiffState(
  rt: Runtime,
  signal?: AbortSignal,
): Promise<WorkspaceDiffState> {
  const probe = await rt.exec(
    unsetGit +
      "if git rev-parse --git-dir >/dev/null 2>&1; then printf git; else printf no-git; fi",
    { cwd: rt.workspace(), signal },
  );
  if (probe.stdout.trim() !== "git") return disabled();
  const temporaryPath = await fs.mkdtemp(
    path.join(os.tmpdir(), "skilled-workspace-diff-"),
  );
  try {
    await fs.writeFile(path.join(temporaryPath, "config"), "", { mode: 0o600 });
    const baselineRev = await checked(
      rt,
      externalIndexScript(rt, temporaryPath, true) + "git write-tree",
      "prepare external workspace diff state",
      signal,
    );
    if (!baselineRev)
      throw new Error(
        "prepare external workspace diff state did not produce a tree",
      );
    return { enabled: true, baselineRev, temporaryPath };
  } catch (e) {
    await fs.rm(temporaryPath, { recursive: true, force: true });
    throw e;
  }
}
export function snapshotRelativeArtifactPath(
  workspaceRoot: string,
  artifact: string,
): string | undefined {
  let clean = path.normalize(artifact);
  if (!artifact || clean === ".") return undefined;
  if (path.isAbsolute(clean)) {
    if (!workspaceRoot) return undefined;
    clean = path.relative(path.normalize(workspaceRoot), clean);
  }
  return !clean ||
    clean === "." ||
    clean === ".." ||
    clean.startsWith(".." + path.sep)
    ? undefined
    : clean;
}
export function gitDiffExcludePathspecs(
  workspaceRoot: string,
  files: string[],
): string[] {
  return files.flatMap((file) => {
    const relative = snapshotRelativeArtifactPath(workspaceRoot, file);
    return relative
      ? [":(exclude,literal)" + relative.split(path.sep).join("/")]
      : [];
  });
}
export async function collectWorkspaceDiff(
  rt: Runtime,
  state: WorkspaceDiffState,
  generated: string[],
  signal?: AbortSignal,
): Promise<string> {
  if (!state.enabled) return "";
  const script =
    (state.temporaryPath
      ? externalIndexScript(rt, state.temporaryPath, false)
      : "set -eu\ngit add --all -- .\n") +
    "git diff --cached --no-ext-diff " +
    shellQuote(state.baselineRev) +
    " -- ." +
    gitDiffExcludePathspecs(rt.workspace(), generated)
      .map((p) => " " + shellQuote(p))
      .join("");
  const r = await rt.exec(script, { cwd: rt.workspace(), signal });
  if (r.exitCode !== 0 && r.exitCode !== 1)
    throw new Error(
      `git diff workspace baseline exited with code ${r.exitCode}: ${r.stderr}`,
    );
  return r.stdout;
}
export function ensureArtifacts(result: SessionResult): SessionArtifacts {
  return (result.artifacts ??= {});
}
export const sessionGeneratedFilesForDiff = (
  result?: SessionResult | null,
): string[] => [
  ...(result?.artifacts?.generated_files ?? []),
  ...(result?.artifacts?.generated_file_sources ?? []),
];
export async function prepareWorkspaceArtifacts(
  rt: Runtime,
  cfg: GitContext | null,
  external: boolean,
  signal?: AbortSignal,
): Promise<{
  cleanup: () => Promise<void>;
  finalize: (result?: SessionResult | null) => Promise<void>;
}> {
  let state = disabled();
  try {
    state = external
      ? await prepareExternalWorkspaceDiffState(rt, signal)
      : await prepareWorkspaceDiffState(rt, cfg, signal);
  } catch (e) {
    warnf("Judge: failed to snapshot workspace before run: %s", String(e));
  }
  return {
    cleanup: async () => {
      if (state.temporaryPath)
        await fs.rm(state.temporaryPath, { recursive: true, force: true });
    },
    finalize: async (result) => {
      if (!result || !state.enabled) return;
      try {
        ensureArtifacts(result).workspace_diff = await collectWorkspaceDiff(
          rt,
          state,
          sessionGeneratedFilesForDiff(result),
          signal,
        );
      } catch (e) {
        warnf("Judge: failed to collect workspace diff: %s", String(e));
      }
    },
  };
}
export function artifactInCleanDir(file: string, dir: string): boolean {
  if (!path.isAbsolute(path.normalize(file))) return false;
  const rel = path.relative(dir, path.normalize(file));
  return (
    !!rel && rel !== "." && rel !== ".." && !rel.startsWith(".." + path.sep)
  );
}
export const artifactsInDir = (files: string[], dir: string): boolean =>
  !!dir &&
  !!files.length &&
  files.every((file) => artifactInCleanDir(file, path.normalize(dir)));
export async function prepareOutputDir(
  outputDir: string,
  configName: string,
  caseID: string,
  subpath: string,
): Promise<string> {
  if (!outputDir || !configName || !caseID) return "";
  try {
    const target = safeOutputPath(outputDir, caseID, configName, subpath);
    await fs.rm(target, { recursive: true, force: true });
    await fs.mkdir(target, { recursive: true, mode: 0o755 });
    return target;
  } catch (e) {
    warnf("Evaluator: failed to prepare target dir: %s", String(e));
    return "";
  }
}
export async function copySessionArtifacts(
  rt: Runtime,
  targetDir: string,
  result: SessionResult,
  signal?: AbortSignal,
): Promise<void> {
  for (const file of result.artifacts?.generated_files ?? []) {
    if (artifactInCleanDir(file, path.normalize(targetDir))) continue;
    const target = path.join(targetDir, path.basename(file));
    try {
      await fs.stat(target);
      continue;
    } catch {}
    try {
      await rt.downloadFile(file, target, signal);
    } catch (e) {
      warnf("Evaluator: failed to download artifact %s: %s", file, String(e));
    }
  }
}
export async function downloadArtifactsIntoDir(
  rt: Runtime,
  targetDir: string,
  result: SessionResult,
  signal?: AbortSignal,
): Promise<void> {
  if (!targetDir) return;
  try {
    await fs.mkdir(targetDir, { recursive: true, mode: 0o755 });
    await copySessionArtifacts(rt, targetDir, result, signal);
  } catch (e) {
    warnf("Evaluator: failed to download artifacts: %s", String(e));
  }
}
export async function ensureArtifactsInOutputDir(
  outputDir: string,
  rt: Runtime,
  configName: string,
  caseID: string,
  subpath: string,
  preparedDir: string,
  result?: SessionResult | null,
  signal?: AbortSignal,
): Promise<void> {
  if (!result?.artifacts?.generated_files?.length) return;
  if (artifactsInDir(result.artifacts.generated_files, preparedDir)) return;
  const target =
    preparedDir ||
    (await prepareOutputDir(outputDir, configName, caseID, subpath));
  await downloadArtifactsIntoDir(rt, target, result, signal);
}
export async function serializeTranscript(
  transcript: Transcript,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eval-transcript-")),
    file = path.join(dir, "transcript.json");
  try {
    await fs.writeFile(file, JSON.stringify(transcript), { mode: 0o600 });
    return {
      path: file,
      cleanup: async () => {
        await fs.rm(dir, { recursive: true, force: true });
      },
    };
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    throw e;
  }
}
export async function archiveIncrementalTurnArtifacts(
  rt: Runtime,
  artifactDir: string | undefined,
  result?: SessionResult | null,
  signal?: AbortSignal,
): Promise<void> {
  if (!artifactDir || !result?.artifacts?.generated_files?.length) return;
  await downloadArtifactsIntoDir(rt, artifactDir, result, signal);
  for (const [i, file] of result.artifacts.generated_files.entries()) {
    if (artifactInCleanDir(file, path.normalize(artifactDir))) continue;
    const archived = path.join(artifactDir, path.basename(file));
    try {
      await fs.stat(archived);
      (result.artifacts.generated_file_sources ??= []).push(file);
      result.artifacts.generated_files[i] = archived;
    } catch {}
  }
}
