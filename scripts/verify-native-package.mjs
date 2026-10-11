import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const file = `${process.argv[2] || "artifacts"}/skilled_${version}_${process.platform}-${process.arch}.${process.platform === "win32" ? "zip" : "tar.gz"}`;
execFileSync(process.execPath, ["scripts/verify-package.mjs", file], {
  stdio: "inherit",
});
