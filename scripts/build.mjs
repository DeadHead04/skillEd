import { rm, mkdir, cp, chmod, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const brand = await readFile("src/brand.ts", "utf8");
if (!brand.includes(`export const VERSION = "${pkg.version}"`))
  throw new Error("Version mismatch; use npm run release:version -- <version>");
await rm("dist", { recursive: true, force: true });
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc"], {
  stdio: "inherit",
});
await mkdir("dist/assets", { recursive: true });
await cp("assets", "dist/assets", { recursive: true });
execFileSync(process.execPath, ["scripts/package-plugins.mjs"], {
  stdio: "inherit",
});

await chmod("dist/src/bootstrap.js", 0o755);
