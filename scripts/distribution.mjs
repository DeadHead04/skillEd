import { cp, mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  npm,
  sha256,
  targets,
  extracted,
  brandInventory,
} from "./distribution-common.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  out = join(root, "artifacts"),
  pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  sourceDirty = !!execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
if (sourceDirty && !process.argv.includes("--allow-dirty"))
  throw new Error(
    "Distribution staging requires a clean committed tree; --allow-dirty is for local development only",
  );
await mkdir(out, { recursive: true });
const records = [];
async function record(path, kind, target) {
  const name = path.split(/[\\/]/).at(-1),
    hash = await sha256(path);
  await writeFile(`${path}.sha256`, `${hash}  ${name}\n`);
  const inventory = await extracted(path, async (dir) => {
    const counts = await brandInventory(dir);
    if (kind === "cli") {
      const metadata = JSON.parse(
        await readFile(join(dir, "installation.json"), "utf8"),
      );
      if (
        metadata.target !== target ||
        metadata.version !== pkg.version ||
        !metadata.fullCLI
      )
        throw new Error(`Unexpected CLI metadata in ${name}`);
      if (
        metadata.sourceCommit !== sourceCommit ||
        metadata.sourceDirty !== sourceDirty
      )
        throw new Error(`CLI source provenance mismatch in ${name}`);
      await stat(
        join(
          dir,
          target.startsWith("win32") ? "runtime/node.exe" : "runtime/bin/node",
        ),
      );
      return {
        ...counts,
        nodeVersion: metadata.nodeVersion,
        nodeArchive: metadata.nodeArchive,
        nodeSHA256: metadata.nodeSHA256,
        sourceCommit: metadata.sourceCommit,
        sourceDirty: metadata.sourceDirty,
      };
    }
    return counts;
  });
  records.push({
    name,
    kind,
    ...(target ? { target } : {}),
    sha256: hash,
    bytes: (await stat(path)).size,
    ...inventory,
  });
}
for (const target of targets)
  await record(
    join(
      out,
      `skilled_${pkg.version}_${target}.${target.startsWith("win32") ? "zip" : "tar.gz"}`,
    ),
    "cli",
    target,
  );
const packed = JSON.parse(
  npm(["pack", "--ignore-scripts", "--json", "--pack-destination", out], {
    cwd: root,
    encoding: "utf8",
  }),
);
await record(join(out, packed[0].filename), "npm");
const stage = join(out, "distribution-stage");
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
for (const host of ["codex", "dsh"]) {
  const name = `${host}-skilled`,
    dir = join(stage, name);
  await cp(join(root, "dist/bundled-plugins", name), dir, { recursive: true });
  if (host === "codex") {
    const manifest = join(dir, ".codex-plugin/plugin.json"),
      j = JSON.parse(await readFile(manifest, "utf8"));
    j.version = pkg.version;
    await writeFile(manifest, JSON.stringify(j, null, 2) + "\n");
    const archive = join(out, `${name}_${pkg.version}.tar.gz`);
    execFileSync("tar", ["-czf", archive, "-C", stage, name]);
    await record(archive, "codex-plugin");
  } else {
    const manifest = join(dir, "package.json"),
      j = JSON.parse(await readFile(manifest, "utf8"));
    j.version = pkg.version;
    j.private = true;
    j.files = [...new Set([...(j.files || []), "LICENSE", "NOTICE"])];
    await writeFile(manifest, JSON.stringify(j, null, 2) + "\n");
    const packed = JSON.parse(
      npm(["pack", "--ignore-scripts", "--json", "--pack-destination", out], {
        cwd: dir,
        encoding: "utf8",
      }),
    );
    await record(join(out, packed[0].filename), "dsh-plugin");
  }
}
await cp(join(root, "skills/skilled-improve"), join(stage, "skilled-improve"), {
  recursive: true,
});
for (const file of ["LICENSE", "NOTICE"])
  await cp(join(root, file), join(stage, "skilled-improve", file));
const workflow = join(out, `skilled-improve_${pkg.version}.tar.gz`);
execFileSync("tar", ["-czf", workflow, "-C", stage, "skilled-improve"]);
await record(workflow, "workflow");
records.sort((a, b) => a.name.localeCompare(b.name));
const manifest = {
  schema_version: 1,
  product: "skilled",
  workflow: "skilled-improve",
  version: pkg.version,
  sourceCommit,
  sourceDirty,
  createdAt: new Date().toISOString(),
  published: false,
  releaseDestination: "https://github.com/DeadHead04/skillEd",
  artifacts: records,
};
await writeFile(
  join(out, "release-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
const manifestHash = await sha256(join(out, "release-manifest.json"));
await writeFile(
  join(out, "release-manifest.json.sha256"),
  `${manifestHash}  release-manifest.json\n`,
);
await writeFile(
  join(out, "checksums.txt"),
  records.map((r) => `${r.sha256}  ${r.name}\n`).join("") +
    `${manifestHash}  release-manifest.json\n`,
);
await rm(stage, { recursive: true, force: true });
console.log(
  JSON.stringify({
    version: pkg.version,
    artifacts: records.length,
    manifest: join(out, "release-manifest.json"),
    published: false,
  }),
);
