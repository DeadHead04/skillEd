import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const target =
  process.argv.find((a) => a.startsWith("--target="))?.split("=")[1] ??
  `${process.platform}-${process.arch}`;
if (!/^(linux|darwin|win32)-(x64|arm64)$/.test(target))
  throw new Error(`Unsupported archive target: ${target}`);
const [os, arch] = target.split("-");
const nodeVersion = (await readFile(join(root, ".nvmrc"), "utf8")).trim();
const nodeOS = os === "win32" ? "win" : os;
const nodeFile = `node-v${nodeVersion}-${nodeOS}-${arch}.${os === "win32" ? "zip" : "tar.gz"}`;
const base = `https://nodejs.org/dist/v${nodeVersion}/`;
const output = join(root, "artifacts");
const cache = join(output, "runtime-cache");
await mkdir(cache, { recursive: true });
const sumsResponse = await fetch(`${base}SHASUMS256.txt`);
if (!sumsResponse.ok)
  throw new Error(`Runtime checksum request failed: ${sumsResponse.status}`);
const sums = await sumsResponse.text();
const expected = sums
  .split("\n")
  .map((line) => line.trim().split(/\s+/))
  .find((parts) => parts[1] === nodeFile)?.[0];
if (!expected || !/^[a-f0-9]{64}$/.test(expected))
  throw new Error(`Missing official checksum: ${nodeFile}`);
const cached = join(cache, nodeFile);
async function sha256(path) {
  const hash = createHash("sha256");
  for await (const part of createReadStream(path)) hash.update(part);
  return hash.digest("hex");
}
let validCache = false;
try {
  validCache = (await sha256(cached)) === expected;
} catch {}
if (!validCache) {
  const response = await fetch(base + nodeFile);
  if (!response.ok || !response.body)
    throw new Error(`Runtime download failed: ${response.status}`);
  const partial = `${cached}.partial`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  if ((await sha256(partial)) !== expected) {
    await rm(partial);
    throw new Error("Runtime checksum mismatch");
  }
  await rename(partial, cached);
}
const name = `skilled_${pkg.version}_${target}`;
const stage = join(output, "stage", name);
await rm(stage, { recursive: true, force: true });
await mkdir(join(stage, "runtime"), { recursive: true });
if (os === "win32") {
  if (process.platform === "win32") {
    const quote = (s) => `'${s.replaceAll("'", "''")}'`;
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath ${quote(cached)} -DestinationPath ${quote(join(stage, "runtime"))}`,
    ]);
  } else execFileSync("unzip", ["-q", cached, "-d", join(stage, "runtime")]);
  const extracted = join(stage, "runtime", `node-v${nodeVersion}-win-${arch}`);
  for (const name of await readdir(extracted))
    await rename(join(extracted, name), join(stage, "runtime", name));
  await rm(extracted, { recursive: true });
} else
  execFileSync("tar", [
    "-xzf",
    cached,
    "-C",
    join(stage, "runtime"),
    "--strip-components=1",
  ]);
const app = join(stage, "app");
await mkdir(app, { recursive: true });
await cp(join(root, "dist", "src"), join(app, "dist", "src"), {
  recursive: true,
});
await cp(join(root, "dist", "assets"), join(app, "dist", "assets"), {
  recursive: true,
});
await cp(join(root, "assets"), join(app, "assets"), { recursive: true });
for (const folder of ["action", "examples"]) {
  await cp(join(root, "dist", folder), join(app, "dist", folder), {
    recursive: true,
  });
}
await cp(join(root, "examples"), join(app, "examples"), { recursive: true });
for (const file of ["install.sh", "install.ps1"])
  await cp(join(root, file), join(app, file));
await cp(
  join(root, "dist", "bundled-plugins"),
  join(app, "dist", "bundled-plugins"),
  { recursive: true },
);
await cp(join(root, "skills"), join(app, "skills"), { recursive: true });
await cp(join(root, "schemas"), join(app, "schemas"), { recursive: true });
await cp(join(root, "package.json"), join(app, "package.json"));
await cp(join(root, "package-lock.json"), join(app, "package-lock.json"));
// Install only production dependencies. No application install scripts execute.
const npmCLI = process.env.npm_execpath;
if (!npmCLI) throw new Error("Run packaging through npm run package.");
execFileSync(
  process.execPath,
  [npmCLI, "ci", "--omit=dev", "--ignore-scripts", "--prefix", app],
  { stdio: "inherit" },
);
for (const file of ["LICENSE", "NOTICE"])
  await cp(join(root, file), join(stage, file));
await writeFile(
  join(stage, "skilled"),
  '#!/bin/sh\nSKILLED_INSTALL_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1\nexport PATH="$SKILLED_INSTALL_DIR/runtime/bin:$PATH"\nexec "$SKILLED_INSTALL_DIR/runtime/bin/node" "$SKILLED_INSTALL_DIR/app/dist/src/bootstrap.js" "$@"\n',
);
await chmod(join(stage, "skilled"), 0o755);
if (os === "win32") {
  await writeFile(
    join(stage, "skilled.cmd"),
    '@echo off\r\nset "PATH=%~dp0runtime;%PATH%"\r\n"%~dp0runtime\\node.exe" "%~dp0app\\dist\\src\\bootstrap.js" %*\r\nexit /b %errorlevel%\r\n',
  );
  await writeFile(
    join(stage, "skilled"),
    '#!/bin/sh\nSKILLED_INSTALL_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1\nexport PATH="$SKILLED_INSTALL_DIR/runtime:$PATH"\nexec "$SKILLED_INSTALL_DIR/runtime/node.exe" "$SKILLED_INSTALL_DIR/app/dist/src/bootstrap.js" "$@"\n',
  );
}
await writeFile(
  join(stage, "installation.json"),
  JSON.stringify(
    {
      product: "skilled",
      version: pkg.version,
      target,
      nodeVersion,
      nodeArchive: nodeFile,
      nodeSHA256: expected,
      phase: 5,
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      sourceDirty: Boolean(
        execFileSync("git", ["status", "--porcelain"], {
          cwd: root,
          encoding: "utf8",
        }).trim(),
      ),
      capabilities: [
        "foundation",
        "agent-adapters",
        "mcp",
        "judges",
        "evaluation-library",
        "reports",
        "user-simulator",
        "runner",
        "full-cli",
        "host-plugins",
        "action",
        "examples",
      ],
      fullCLI: true,
    },
    null,
    2,
  ) + "\n",
);
const archive = join(output, `${name}.${os === "win32" ? "zip" : "tar.gz"}`);
// zip updates existing archives; remove the prior candidate so deleted files cannot survive.
await rm(archive, { force: true });
if (os === "win32") {
  if (process.platform === "win32") {
    const quote = (s) => `'${s.replaceAll("'", "''")}'`;
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Compress-Archive -LiteralPath ${quote(stage)} -DestinationPath ${quote(archive)} -Force`,
    ]);
  } else execFileSync("zip", ["-qr", archive, name], { cwd: dirname(stage) });
} else execFileSync("tar", ["-czf", archive, "-C", dirname(stage), name]);
const hash = await sha256(archive);
await writeFile(
  `${archive}.sha256`,
  `${hash}  ${archive.split(/[\\/]/).at(-1)}\n`,
);
console.log(
  JSON.stringify({
    archive,
    stage,
    target,
    sha256: hash,
    nodeSHA256: expected,
  }),
);
