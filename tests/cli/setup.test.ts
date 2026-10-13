import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { setupWorkflow } from "../../src/cli/setup.js";

for (const host of ["codex", "claude-code"] as const)
  test(`real project workflow install, repeat, change protection and removal: ${host}`, async t => {
    const project = await mkdtemp(path.join(os.tmpdir(), "skilled-setup-"));
    t.after(() => rm(project, { recursive: true, force: true }));
    const hostDir = path.join(project, host === "codex" ? ".agents" : ".claude");
    await mkdir(hostDir);
    await writeFile(path.join(hostDir, "settings.json"), "preserve settings\n");
    await setupWorkflow(project, host);
    const skill = path.join(hostDir, "skills/skilled-improve");
    const file = path.join(skill, "SKILL.md");
    const original = await readFile(file, "utf8");
    assert.match(original, /name: skilled-improve/);
    assert.ok((await stat(path.join(skill, "references/cli.md"))).isFile());
    await setupWorkflow(project, host);
    assert.equal(await readFile(file, "utf8"), original);
    await writeFile(file, original + "\nLocal edit\n");
    await assert.rejects(setupWorkflow(project, host), /local changes/);
    await assert.rejects(setupWorkflow(project, host, true), /local changes/);
    await writeFile(file, original);
    await setupWorkflow(project, host, true);
    await assert.rejects(stat(skill), { code: "ENOENT" });
    assert.equal(await readFile(path.join(hostDir, "settings.json"), "utf8"), "preserve settings\n");
    assert.equal(await setupWorkflow(project, host, true), "Workflow is not installed");
  });
