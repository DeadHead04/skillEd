import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, open, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installSkill, listSkillFiles } from "../../src/agent/skill.js";
import { NoneRuntime } from "../../src/runtime/none.js";
import { DockerRuntime } from "../../src/runtime/docker.js";
import { createSkillManifest, MAX_SKILL_FILE_BYTES, validateSkillSource, verifyInstalledSkill } from "../../src/skill/integrity.js";

const metadata = "---\nname: file-check\ndescription: Check files on disk\n---\n";
async function setup(t: test.TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "skilled-integrity-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "source");
  await mkdir(path.join(source, "references"), { recursive: true });
  await mkdir(path.join(source, "scripts"));
  const rt = new NoneRuntime({ type: "none", workspaceDir: directory });
  await rt.create();
  return { directory, source, rt };
}

test("strict source validation checks real YAML metadata and declared local files", async (t) => {
  const { source } = await setup(t);
  await writeFile(path.join(source, "references", "guide with spaces.md"), "A guide.");
  await writeFile(path.join(source, "scripts", "check.sh"), "#!/bin/sh\nexit 0\n");
  await writeFile(path.join(source, "SKILL.md"), metadata + [
    "[guide](<references/guide with spaces.md#intro>)",
    "Use `scripts/check.sh`.",
    "[remote](https://example.com/missing) [anchor](#intro)",
    "`assets/*.tmpl` and `assets/<name>.tmpl` are example patterns.",
    "```markdown", "[example](missing.md)", "```",
  ].join("\n"));
  const result = await validateSkillSource(source);
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(result.name, "file-check");
  assert.deepEqual(result.references, ["references/guide with spaces.md", "scripts/check.sh"]);
});

test("source errors identify invalid metadata, missing files and reference definitions", async (t) => {
  const { source } = await setup(t);
  await writeFile(path.join(source, "SKILL.md"), "---\nname: 123\ndescription: ''\n---\n[guide][reference]\n[reference]: references/missing.md\n");
  const result = await validateSkillSource(source);
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 3);
  assert.match(result.errors.join("\n"), /name must be a non-empty string/);
  assert.match(result.errors.join("\n"), /description must be a non-empty string/);
  assert.match(result.errors.join("\n"), /references\/missing.md/);
});

test("source validation reports missing, malformed and unterminated frontmatter", async (t) => {
  const { source } = await setup(t);
  for (const [content, pattern] of [
    ["# Legacy Skill", /must start with YAML/],
    ["---\nname: [\n---\n", /invalid SKILL.md YAML/],
    ["---\nname: example\n", /closing ---/],
  ] as const) {
    await writeFile(path.join(source, "SKILL.md"), content);
    const result = await validateSkillSource(source);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), pattern);
  }
});

test("source validation rejects an actual oversized SKILL.md before reading it", async (t) => {
  const { source } = await setup(t);
  const file = await open(path.join(source, "SKILL.md"), "w");
  try { await file.truncate(MAX_SKILL_FILE_BYTES + 1); }
  finally { await file.close(); }
  const result = await validateSkillSource(source);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /SKILL.md exceeds the 4 MiB read limit/);
});

test("source validation refuses an actual FIFO without waiting for a writer", {
  skip: process.platform === "win32" && "POSIX named pipes are unavailable on Windows",
  timeout: 10000,
}, async (t) => {
  const { source, rt } = await setup(t);
  await promisify(execFile)("mkfifo", [path.join(source, "SKILL.md")]);
  const result = await validateSkillSource(source);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /SKILL.md must be a regular file/);
  await assert.rejects(installSkill(rt, source, "installed"), /SKILL.md must be a regular file/);
});

test("declared references cannot escape the bundled Skill directory", async (t) => {
  const { directory, source } = await setup(t);
  await writeFile(path.join(directory, "outside.md"), "outside");
  await writeFile(path.join(source, "SKILL.md"), metadata + "[outside](../outside.md)\n");
  assert.match((await validateSkillSource(source)).errors.join("\n"), /outside the Skill directory/);
  if (process.platform !== "win32") {
    await symlink(path.join(directory, "outside.md"), path.join(source, "references", "alias.md"));
    await writeFile(path.join(source, "SKILL.md"), metadata + "[outside](references/alias.md)\n");
    assert.match((await validateSkillSource(source)).errors.join("\n"), /resolves outside/);
  }
});

test("incomplete install selections fail before writing installed files", async (t) => {
  const { directory, source, rt } = await setup(t);
  await writeFile(path.join(source, "SKILL.md"), metadata + "Use `scripts/check.sh`.\n");
  await writeFile(path.join(source, "scripts", "check.sh"), "#!/bin/sh\nexit 0\n");
  await assert.rejects(installSkill(rt, source, "installed", ["scripts/**"]), /excludes SKILL.md/);
  await assert.rejects(stat(path.join(directory, "installed")), { code: "ENOENT" });
  await assert.rejects(installSkill(rt, source, "installed", ["*.md"]), /excludes declared reference: scripts\/check.sh/);
  await assert.rejects(stat(path.join(directory, "installed")), { code: "ENOENT" });
  await rm(path.join(source, "scripts", "check.sh"));
  await assert.rejects(installSkill(rt, source, "installed"), /missing or unreadable local reference/);
});

test("actual install verifies bytes and detects later corruption and missing installed files", async (t) => {
  const { directory, source, rt } = await setup(t);
  await writeFile(path.join(source, "SKILL.md"), metadata + "Use `scripts/check.sh`.\n");
  await writeFile(path.join(source, "scripts", "check.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const manifest = await createSkillManifest(source, await listSkillFiles(source));
  await installSkill(rt, source, "installed");
  await verifyInstalledSkill(rt, "installed", manifest);
  assert.equal(await readFile(path.join(directory, "installed", "SKILL.md"), "utf8"), metadata + "Use `scripts/check.sh`.\n");
  await writeFile(path.join(directory, "installed", "scripts", "check.sh"), "corrupted bytes");
  await assert.rejects(verifyInstalledSkill(rt, "installed", manifest), /scripts.*check.sh: SHA-256 mismatch/);
  await rm(path.join(directory, "installed", "SKILL.md"));
  await assert.rejects(verifyInstalledSkill(rt, "installed", manifest), /integrity check failed for SKILL.md/);
});

test("legacy metadata-free and name-only Skills remain installable but strict validation flags them", async (t) => {
  const { source, rt } = await setup(t);
  for (const content of ["# Legacy Skill", "---\nname: legacy\n---\n# Legacy Skill"]) {
    await writeFile(path.join(source, "SKILL.md"), content);
    await installSkill(rt, source, "installed");
    assert.equal((await validateSkillSource(source)).valid, false);
  }
});

test("in-place install still validates declared dependencies", async (t) => {
  const { source, rt } = await setup(t);
  await writeFile(path.join(source, "SKILL.md"), metadata + "Use `scripts/missing.sh`.\n");
  await assert.rejects(installSkill(rt, source, source), /missing or unreadable local reference/);
});

test("validate --skill runs strict validation through the real CLI process without eval.yaml", async (t) => {
  const { directory, source } = await setup(t);
  const driver = fileURLToPath(new URL("../cli/driver.js", import.meta.url));
  const run = promisify(execFile);
  const options = { cwd: directory, env: { ...process.env, HOME: directory, XDG_CONFIG_HOME: path.join(directory, "config"), OTEL_TRACES_EXPORTER: "none", OTEL_METRICS_EXPORTER: "none" } };
  await writeFile(path.join(source, "SKILL.md"), metadata);
  const good = await run(process.execPath, [driver, "validate", "--skill", source], options);
  assert.match(good.stdout, /SKILL.md is valid/);
  await writeFile(path.join(source, "SKILL.md"), "# Missing metadata");
  await assert.rejects(run(process.execPath, [driver, "validate", "--skill", source], options), (error: unknown) => {
    assert.match((error as { stderr: string }).stderr, /must start with YAML/);
    return true;
  });
});

test("Docker installation reads back real container bytes and detects corruption", {
  skip: process.env.SKILLED_DOCKER_INTEGRATION !== "1" && "set SKILLED_DOCKER_INTEGRATION=1",
  timeout: 120000,
}, async (t) => {
  const { source } = await setup(t);
  await writeFile(path.join(source, "SKILL.md"), metadata + "Use `scripts/check.sh`.\n");
  await writeFile(path.join(source, "scripts", "check.sh"), "#!/bin/sh\nprintf 'verified'\n", { mode: 0o755 });
  const rt = new DockerRuntime({ type: "docker", image: process.env.SKILLED_DOCKER_INTEGRATION_IMAGE || "alpine:3.20", delete: true, networkPolicy: "deny_all" });
  t.after(() => rt.close());
  await rt.create();
  const manifest = await createSkillManifest(source, await listSkillFiles(source));
  await installSkill(rt, source, "installed");
  await verifyInstalledSkill(rt, "installed", manifest);
  const executed = await rt.exec("./installed/scripts/check.sh");
  assert.equal(executed.exitCode, 0, executed.stderr);
  assert.equal(executed.stdout, "verified");
  const corrupted = await rt.exec("printf 'changed' > installed/SKILL.md");
  assert.equal(corrupted.exitCode, 0, corrupted.stderr);
  await assert.rejects(verifyInstalledSkill(rt, "installed", manifest), /SKILL.md: SHA-256 mismatch/);
});
