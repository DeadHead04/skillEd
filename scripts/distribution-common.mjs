import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";
export const targets = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
];
export async function sha256(path) {
  const h = createHash("sha256");
  for await (const part of createReadStream(path)) h.update(part);
  return h.digest("hex");
}
export function npm(args, options = {}) {
  return process.env.npm_execpath
    ? execFileSync(
        process.execPath,
        [process.env.npm_execpath, ...args],
        options,
      )
    : execFileSync(
        process.platform === "win32" ? "npm.cmd" : "npm",
        args,
        options,
      );
}
export async function extracted(path, run) {
  const root = await mkdtemp(join(tmpdir(), "skilled-distribution-"));
  try {
    if (path.endsWith(".zip")) {
      if (process.platform === "win32") {
        const q = (s) => `'${s.replaceAll("'", "''")}'`;
        execFileSync("powershell.exe", [
          "-NoProfile",
          "-Command",
          `Expand-Archive -LiteralPath ${q(path)} -DestinationPath ${q(root)}`,
        ]);
      } else execFileSync("unzip", ["-q", path, "-d", root]);
    } else execFileSync("tar", ["-xzf", path, "-C", root]);
    const names = await readdir(root);
    if (names.length !== 1)
      throw new Error(`${basename(path)} must have one top-level directory`);
    return await run(join(root, names[0]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
export async function brandInventory(root) {
  let files = 0,
    bytes = 0;
  const legacy = /(?:skill|scale)[-_ ]?up(?:per|er)?/gi;
  async function walk(path) {
    for (const e of await readdir(path, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      legacy.lastIndex = 0;
      if (legacy.test(e.name))
        throw new Error(`Legacy product path: ${e.name}`);
      const p = join(path, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) {
        files++;
        bytes += (await stat(p)).size;
        const content = await readFile(p);
        if (content.includes(0)) continue;
        let text;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(content);
        } catch {
          continue;
        }
        legacy.lastIndex = 0;
        if (legacy.test(text))
          throw new Error(`Legacy product text in ${p.slice(root.length + 1)}`);
      }
    }
  }
  await walk(root);
  return {
    ownedFiles: files,
    ownedBytes: bytes,
    vendorDependenciesExcludedFromBrandScan: true,
  };
}
