import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  sha256,
  targets,
  extracted,
  brandInventory,
} from "./distribution-common.mjs";
const root = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(dirname(fileURLToPath(import.meta.url)), "../artifacts");
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const notices = await Promise.all(
  ["LICENSE", "NOTICE"].map(async (name) => ({
    name,
    bytes: await readFile(join(sourceRoot, name)),
  })),
);
const manifest = JSON.parse(
  await readFile(join(root, "release-manifest.json"), "utf8"),
);
assert.equal(manifest.product, "skilled");
assert.equal(manifest.workflow, "skilled-improve");
assert.equal(manifest.published, false);
assert.equal(manifest.releaseDestination, "https://github.com/DeadHead04/skillEd");
assert.deepEqual(
  manifest.artifacts
    .filter((r) => r.kind === "cli")
    .map((r) => r.target)
    .sort(),
  [...targets].sort(),
);
assert.equal(manifest.artifacts.length, 10);
assert.equal(new Set(manifest.artifacts.map((r) => r.name)).size, 10);
assert.deepEqual(
  manifest.artifacts
    .filter((r) => r.kind !== "cli")
    .map((r) => r.kind)
    .sort(),
  ["codex-plugin", "dsh-plugin", "npm", "workflow"],
);
const checksums = new Map(
  (await readFile(join(root, "checksums.txt"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => {
      const m = /^([a-f0-9]{64})  (.+)$/.exec(line);
      assert(m);
      assert.equal(basename(m[2]), m[2]);
      return [m[2], m[1]];
    }),
);
assert.equal(
  checksums.get("release-manifest.json"),
  await sha256(join(root, "release-manifest.json")),
);
for (const record of manifest.artifacts) {
  assert.equal(basename(record.name), record.name);
  const path = join(root, record.name);
  assert.equal(await sha256(path), record.sha256, record.name);
  assert.equal(checksums.get(record.name), record.sha256);
  assert.equal(
    (await readFile(`${path}.sha256`, "utf8")).trim(),
    `${record.sha256}  ${record.name}`,
  );
  assert.equal((await stat(path)).size, record.bytes);
  await extracted(path, async (dir) => {
    for (const { name, bytes } of notices)
      assert.deepEqual(
        await readFile(join(dir, name)),
        bytes,
        `${record.name} must retain the complete root ${name}`,
      );
    const inventory = await brandInventory(dir);
    assert.equal(inventory.ownedFiles, record.ownedFiles);
    assert.equal(inventory.ownedBytes, record.ownedBytes);
    if (record.kind === "cli") {
      const metadata = JSON.parse(
        await readFile(join(dir, "installation.json"), "utf8"),
      );
      assert.equal(metadata.version, manifest.version);
      assert.equal(metadata.sourceCommit, manifest.sourceCommit);
      assert.equal(metadata.sourceDirty, manifest.sourceDirty);
      assert.equal(metadata.target, record.target);
      assert.equal(metadata.fullCLI, true);
      assert.equal(metadata.nodeSHA256, record.nodeSHA256);
      assert.match(metadata.nodeSHA256, /^[a-f0-9]{64}$/);
      await stat(
        join(
          dir,
          record.target.startsWith("win32")
            ? "runtime/node.exe"
            : "runtime/bin/node",
        ),
      );
    } else if (record.kind === "workflow") {
      assert.match(
        await readFile(join(dir, "SKILL.md"), "utf8"),
        /name: skilled-improve/,
      );
    } else {
      const p = JSON.parse(
        await readFile(
          join(
            dir,
            record.kind === "codex-plugin"
              ? ".codex-plugin/plugin.json"
              : "package.json",
          ),
          "utf8",
        ),
      );
      assert.equal(p.version, manifest.version);
      assert.equal(
        p.name,
        record.kind === "npm"
          ? "skilled"
          : record.kind === "codex-plugin"
            ? "codex-skilled"
            : "dsh-skilled",
      );
      const required =
        record.kind === "npm"
          ? [
              "dist/src/bootstrap.js",
              "dist/src/api/index.js",
              "dist/examples/deepseek-harness/evals/fixtures/dsh_runner.js",
              "skills/skilled-improve/SKILL.md",
            ]
          : record.kind === "codex-plugin"
            ? [
                "scripts/observer.js",
                ".mcp.json",
                "hooks/hooks.json",
                "skills/skilled-improve/SKILL.md",
                "schemas/skill-observation/v1alpha1/observation.schema.json",
              ]
            : [
                "index.js",
                "lib/core.js",
                "lib/observer.js",
                "cordis.patch.yml",
                "dist/skilled-improve/SKILL.md",
                "dist/skill-observation/v1alpha1/observation.schema.json",
              ];
      for (const file of required) await stat(join(dir, file));
    }
  });
}
console.log(
  JSON.stringify({
    passed: true,
    version: manifest.version,
    archives: manifest.artifacts.length,
    cliTargets: targets,
    integrity: true,
    ownedBranding: true,
    licenseAndNotice: true,
    nativeExecutionNotImplied: true,
  }),
);
