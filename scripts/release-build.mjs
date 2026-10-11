import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (!process.env.npm_execpath)
  throw new Error("Run through npm run release:build");
const dirty = execFileSync("git", ["status", "--porcelain"], {
  encoding: "utf8",
}).trim();
if (dirty && !process.argv.includes("--allow-dirty"))
  throw new Error(
    "Release requires a clean commit. --allow-dirty is only for local development artifacts.",
  );
const expectedNode = (await readFile(".nvmrc", "utf8")).trim();
if (process.version !== `v${expectedNode}`)
  throw new Error(`Use pinned Node ${expectedNode}`);
for (const file of [
  "plugins/codex-skilled/.codex-plugin/plugin.json",
  "plugins/dsh-skilled/package.json",
]) {
  if (JSON.parse(await readFile(file, "utf8")).version !== pkg.version)
    throw new Error(`Version mismatch: ${file}`);
}
execFileSync(process.execPath, [process.env.npm_execpath, "run", "verify"], {
  stdio: "inherit",
});
for (const target of [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
])
  execFileSync(
    process.execPath,
    ["scripts/package.mjs", `--target=${target}`],
    { stdio: "inherit" },
  );
execFileSync(
  process.execPath,
  [
    "scripts/distribution.mjs",
    ...(process.argv.includes("--allow-dirty") ? ["--allow-dirty"] : []),
  ],
  { stdio: "inherit" },
);
execFileSync(process.execPath, ["scripts/distribution-check.mjs"], {
  stdio: "inherit",
});
console.log(
  `Release candidate ${pkg.version} staged locally; no files published.`,
);
