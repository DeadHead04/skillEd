import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NoneRuntime } from "../../src/runtime/none.js";
import { decode } from "../../src/contracts/decode.js";
import type { CaseConfig, EvalConfig } from "../../src/contracts/schema.js";
import {
  FixtureRegistry,
  GitCheckoutUploader,
  validateContextFilePath,
  validateGitBranch,
  validateGitRemote,
  collectGlobArtifacts,
  prepareExternalWorkspaceDiffState,
  collectWorkspaceDiff,
  prepareWorkspaceDiffState,
} from "../../src/evaluator/index.js";
async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "skilled-fixture-real-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const rt = new NoneRuntime({ type: "none", delete: true });
  await rt.create();
  t.after(() => rt.close());
  return { root, rt };
}
const cfg = (v: unknown) => decode<CaseConfig>("CaseConfig", v);
async function execute(rt: NoneRuntime, script: string) {
  const r = await rt.exec(script, { cwd: rt.workspace() });
  assert.equal(r.exitCode, 0, r.stderr);
  return r.stdout.trim();
}
test("real git fixture branch selection precedes inline overrides and diff application", async (t) => {
  const { root, rt } = await fixture(t);
  const repo = path.join(root, "repo");
  await fs.mkdir(repo);
  const source = new NoneRuntime({ type: "none", workspaceDir: repo });
  await source.create();
  await execute(
    source,
    "git init -q && git config user.name skilled && git config user.email skilled@example.invalid && printf main > input.txt && git add . && git commit -qm initial && git switch -c selected && printf selected > input.txt && git commit -am selected -q && git switch -",
  );
  const patchName = path.basename(root) + " patch.diff";
  await fs.writeFile(
    path.join(root, patchName),
    "diff --git a/input.txt b/input.txt\n--- a/input.txt\n+++ b/input.txt\n@@ -1 +1 @@\n-inline\n+patched\n",
  );
  t.after(() => fs.rm(path.join(os.tmpdir(), patchName), { force: true }));
  await new FixtureRegistry().uploadAll(
    rt,
    cfg({
      context: {
        repo_fixture: "repo",
        git: { checkout: "selected", apply_diff: patchName },
        files: { "input.txt": "inline\n" },
      },
    }),
    root,
    root,
  );
  assert.equal(
    await fs.readFile(path.join(rt.workspace(), "input.txt"), "utf8"),
    "patched\n",
  );
  assert.equal(await execute(rt, "git branch --show-current"), "selected");
  await assert.rejects(
    new GitCheckoutUploader().upload(
      rt,
      cfg({ context: { git: { checkout: "missing" } } }),
      root,
      root,
    ),
    /configured branch does not exist/,
  );
});
test("real unborn git branch and literal remote values; unsafe inputs rejected", async (t) => {
  const { root, rt } = await fixture(t);
  const remote = "https://example.invalid/a'$(touch SHOULD_NOT_EXIST)";
  await new FixtureRegistry().uploadAll(
    rt,
    cfg({
      context: {
        git: {
          init: true,
          checkout: "new-branch",
          remotes: [{ name: "origin", url: remote }],
        },
        files: { "nested/file.txt": "bytes" },
      },
    }),
    root,
    root,
  );
  assert.equal(await execute(rt, "git branch --show-current"), "new-branch");
  assert.equal(await execute(rt, "git remote get-url origin"), remote);
  await assert.rejects(fs.stat(path.join(rt.workspace(), "SHOULD_NOT_EXIST")));
  for (const p of ["", ".", "..", "../outside", "/absolute"])
    assert.throws(() => validateContextFilePath(p));
  for (const p of ["-bad", "bad branch", "line\nend"])
    assert.throws(() => validateGitBranch(p));
  for (const remote of [
    { name: "", url: "x" },
    { name: "-bad", url: "x" },
    { name: "good", url: "-bad" },
    { name: "good", url: "a\nb" },
  ])
    assert.throws(() => validateGitRemote(remote));
  await assert.rejects(
    new FixtureRegistry().uploadAll(
      rt,
      cfg({ context: { files: { "../escape": "bad" } } }),
      root,
      root,
    ),
    /escapes workspace/,
  );
});
test("real artifact glob collection preserves nested paths, excludes git, removes stale files", async (t) => {
  const { root, rt } = await fixture(t);
  await execute(
    rt,
    "mkdir -p one two .git && printf first > one/same.txt && printf second > two/same.txt && printf hidden > .git/internal",
  );
  const evalCfg = decode<EvalConfig>("EvalConfig", {
      cases: { defaults: { collect_artifacts: ["**/*"] } },
    }),
    c = cfg({ id: "collect", collect_artifacts: ["one/**"] });
  await collectGlobArtifacts(root, evalCfg, rt, "with_skill", c);
  const target = path.join(root, "collect/with_skill/outputs/workspace");
  assert.equal(
    await fs.readFile(path.join(target, "one/same.txt"), "utf8"),
    "first",
  );
  assert.equal(
    await fs.readFile(path.join(target, "two/same.txt"), "utf8"),
    "second",
  );
  await assert.rejects(fs.stat(path.join(target, ".git")));
  await execute(rt, "rm two/same.txt");
  await collectGlobArtifacts(root, evalCfg, rt, "with_skill", c);
  await assert.rejects(fs.stat(path.join(target, "two/same.txt")));
});
test("external git diff captures real file edits without changing HEAD, config or index", async (t) => {
  const { rt } = await fixture(t);
  await execute(
    rt,
    "git init -q && git config user.name skilled && git config user.email skilled@example.invalid && printf initial > tracked.txt && git add . && git commit -qm initial && printf staged > staged.txt && git add staged.txt",
  );
  await fs.writeFile(
    path.join(rt.workspace(), ":(glob)*"),
    "literal magic path",
  );
  const before = {
    head: await execute(rt, "git rev-parse HEAD"),
    index: await fs.readFile(path.join(rt.workspace(), ".git/index")),
    config: await fs.readFile(path.join(rt.workspace(), ".git/config")),
  };
  const state = await prepareExternalWorkspaceDiffState(rt);
  t.after(() => fs.rm(state.temporaryPath, { recursive: true, force: true }));
  assert.equal(state.enabled, true);
  await fs.writeFile(path.join(rt.workspace(), "tracked.txt"), "changed");
  await fs.writeFile(path.join(rt.workspace(), ":(glob)*"), "literal changed");
  await fs.writeFile(path.join(rt.workspace(), "framework.json"), "internal");
  const diff = await collectWorkspaceDiff(rt, state, ["framework.json"]);
  assert.match(diff, /changed/);
  assert.ok(diff.includes(":(glob)*"));
  assert.ok(!diff.includes("framework.json"));
  assert.equal(await execute(rt, "git rev-parse HEAD"), before.head);
  assert.deepEqual(
    await fs.readFile(path.join(rt.workspace(), ".git/index")),
    before.index,
  );
  assert.deepEqual(
    await fs.readFile(path.join(rt.workspace(), ".git/config")),
    before.config,
  );
});
test("external nongit diff never initializes git; owned git diff sees changes after agent commit", async (t) => {
  const { rt } = await fixture(t);
  assert.equal((await prepareExternalWorkspaceDiffState(rt)).enabled, false);
  await assert.rejects(fs.stat(path.join(rt.workspace(), ".git")));
  const git = cfg({ context: { git: { init: true } } }).context.git;
  const state = await prepareWorkspaceDiffState(rt, git);
  assert.equal(state.enabled, true);
  await execute(
    rt,
    "printf new > created.txt && git add . && git commit -qm created",
  );
  assert.match(await collectWorkspaceDiff(rt, state, []), /created.txt/);
});
