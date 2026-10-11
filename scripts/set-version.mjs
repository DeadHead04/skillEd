import { readFile, writeFile } from "node:fs/promises";
import YAML from "yaml";
const version = process.argv[2]?.replace(/^v/, "");
if (
  !version ||
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(
    version,
  )
)
  throw new Error("Usage: npm run release:version -- <semver>");
for (const file of [
  "package.json",
  "package-lock.json",
  "plugins/codex-skilled/.codex-plugin/plugin.json",
  "plugins/dsh-skilled/package.json",
]) {
  const data = JSON.parse(await readFile(file, "utf8"));
  data.version = version;
  if (data.packages?.[""]) data.packages[""].version = version;
  await writeFile(file, JSON.stringify(data, null, 2) + "\n");
}
const brand = await readFile("src/brand.ts", "utf8");
await writeFile(
  "src/brand.ts",
  brand.replace(
    /export const VERSION = "[^"]+"/,
    `export const VERSION = "${version}"`,
  ),
);
const action = YAML.parseDocument(await readFile("action.yml", "utf8"));
action.setIn(["inputs", "skilled-version", "default"], version);
await writeFile("action.yml", String(action));
const docker = await readFile("action/Dockerfile", "utf8");
await writeFile(
  "action/Dockerfile",
  docker.replace(
    /org\.opencontainers\.image\.version="[^"]+"/,
    `org.opencontainers.image.version="${version}"`,
  ),
);
console.log(
  `Set candidate version ${version}. Review, test, and commit before release:build.`,
);
