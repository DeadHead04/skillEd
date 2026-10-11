// Modified for the skilled TypeScript distribution.
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Runtime } from "../runtime/types.js";
import type { CaseConfig, GitRemote } from "../contracts/schema.js";
import { quotePOSIX } from "../platform/index.js";
export interface FixtureUploader {
  upload(
    rt: Runtime,
    cfg: CaseConfig,
    skillDir: string,
    fixtureBaseDir: string,
    signal?: AbortSignal,
  ): Promise<void>;
}
export function validateContextFilePath(value: string): void {
  const clean = path.normalize(value);
  if (!value || clean === ".")
    throw new Error(
      `context file path ${JSON.stringify(value)} is empty or targets workspace root`,
    );
  if (path.isAbsolute(clean))
    throw new Error(
      `context file path ${JSON.stringify(value)} must be relative`,
    );
  if (clean === ".." || clean.startsWith(".." + path.sep))
    throw new Error(
      `context file path ${JSON.stringify(value)} escapes workspace`,
    );
}
export function validateGitBranch(branch: string): void {
  if (/[\n\r\0\t ]/.test(branch))
    throw new Error(
      `git checkout branch ${JSON.stringify(branch)} contains whitespace or control characters`,
    );
  if (branch.startsWith("-"))
    throw new Error(
      `git checkout branch ${JSON.stringify(branch)} must not start with '-'`,
    );
}
export function validateGitRemote(remote: GitRemote): void {
  if (!remote.name) throw new Error("git remote name must not be empty");
  if (/[\n\r\0\t ]/.test(remote.name))
    throw new Error(
      `git remote name ${JSON.stringify(remote.name)} contains whitespace or control characters`,
    );
  if (remote.name.startsWith("-"))
    throw new Error(
      `git remote name ${JSON.stringify(remote.name)} must not start with '-'`,
    );
  if (/[\n\r\0]/.test(remote.url))
    throw new Error(
      `git remote url for ${JSON.stringify(remote.name)} contains control characters`,
    );
  if (remote.url.startsWith("-"))
    throw new Error(
      `git remote url for ${JSON.stringify(remote.name)} must not start with '-'`,
    );
}
async function execute(
  rt: Runtime,
  command: string,
  label: string,
  signal?: AbortSignal,
) {
  let r;
  try {
    r = await rt.exec(command, { cwd: rt.workspace(), signal });
  } catch (error) {
    throw new Error(
      `${label} failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (r.exitCode !== 0)
    throw new Error(`${label} exited with code ${r.exitCode}: ${r.stderr}`);
}
export class RepoFixtureUploader implements FixtureUploader {
  async upload(
    rt: Runtime,
    cfg: CaseConfig,
    _skillDir: string,
    base: string,
    signal?: AbortSignal,
  ) {
    if (!cfg.context.repo_fixture) return;
    const source = path.join(base, cfg.context.repo_fixture);
    try {
      await fs.stat(source);
    } catch (error) {
      throw new Error(
        `repo_fixture ${JSON.stringify(source)} not found: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    try {
      await rt.uploadDir(source, ".", signal);
    } catch (error) {
      throw new Error(
        `failed to upload repo_fixture: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
}
export class ContextFilesUploader implements FixtureUploader {
  async upload(
    rt: Runtime,
    cfg: CaseConfig,
    _skillDir: string,
    _base: string,
    signal?: AbortSignal,
  ) {
    const files = cfg.context.files;
    if (!Object.keys(files).length) return;
    const tmp = await fs.mkdtemp(
      path.join(os.tmpdir(), "skilled-context-file-"),
    );
    try {
      const file = path.join(tmp, "content");
      for (const target of Object.keys(files).sort()) {
        validateContextFilePath(target);
        await fs.writeFile(file, files[target]!, { mode: 0o600, flush: true });
        try {
          await rt.uploadFile(file, target, signal);
        } catch (error) {
          throw new Error(
            `failed to upload context file ${JSON.stringify(target)}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }
}
export class GitInitUploader implements FixtureUploader {
  async upload(
    rt: Runtime,
    cfg: CaseConfig,
    _skillDir: string,
    _base: string,
    signal?: AbortSignal,
  ) {
    if (!cfg.context.git?.init) return;
    let script =
      "set -eu\ngit init -q\ngit config user.name skilled\ngit config user.email skilled@example.invalid\n";
    for (const remote of cfg.context.git.remotes) {
      validateGitRemote(remote);
      script +=
        "git remote add " +
        quotePOSIX(remote.name) +
        " " +
        quotePOSIX(remote.url) +
        "\n";
    }
    await execute(rt, script, "git init", signal);
  }
}
export class GitCheckoutUploader implements FixtureUploader {
  async upload(
    rt: Runtime,
    cfg: CaseConfig,
    _skillDir: string,
    _base: string,
    signal?: AbortSignal,
  ) {
    const branch = cfg.context.git?.checkout;
    if (!branch) return;
    validateGitBranch(branch);
    const quoted = quotePOSIX(branch);
    await execute(
      rt,
      "set -eu\nif git switch " +
        quoted +
        " 2>/dev/null; then :\nelif ! git rev-parse --verify --quiet HEAD >/dev/null 2>&1; then git switch -c " +
        quoted +
        "\nelse echo 'configured branch does not exist in the fixture repo' >&2; exit 1\nfi\n",
      "git checkout " + JSON.stringify(branch),
      signal,
    );
  }
}
export class ApplyDiffUploader implements FixtureUploader {
  async upload(
    rt: Runtime,
    cfg: CaseConfig,
    skillDir: string,
    _base: string,
    signal?: AbortSignal,
  ) {
    const diff = cfg.context.git?.apply_diff;
    if (!diff) return;
    const source = path.join(skillDir, diff);
    try {
      await fs.stat(source);
    } catch (error) {
      throw new Error(
        `apply_diff ${JSON.stringify(source)} not found: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    const target = path.join(os.tmpdir(), path.basename(source));
    try {
      await rt.uploadFile(source, target, signal);
    } catch (error) {
      throw new Error(
        `failed to upload diff file: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    let result;
    try {
      result = await rt.exec("git apply -- " + quotePOSIX(target), {
        cwd: rt.workspace(),
        signal,
      });
    } catch (error) {
      throw new Error(
        `failed to apply diff: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (result.exitCode !== 0)
      throw new Error(
        `git apply failed with exit code ${result.exitCode}: ${result.stderr}`,
      );
  }
}
export class FixtureRegistry {
  readonly uploaders: FixtureUploader[] = [
    new RepoFixtureUploader(),
    new GitInitUploader(),
    new GitCheckoutUploader(),
    new ContextFilesUploader(),
    new ApplyDiffUploader(),
  ];
  async uploadAll(
    rt: Runtime,
    cfg: CaseConfig,
    skillDir: string,
    base: string,
    signal?: AbortSignal,
  ) {
    for (const uploader of this.uploaders)
      await uploader.upload(rt, cfg, skillDir, base, signal);
  }
}
export const newFixtureRegistry = (): FixtureRegistry => new FixtureRegistry();
