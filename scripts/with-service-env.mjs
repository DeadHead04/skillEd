import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
if (!process.argv[2] || !process.env.npm_execpath)
  throw new Error(
    "Usage: npm run gate:services -- <OpenSandbox environment.json> [--phase=1|2|3|4|5]",
  );
const values = JSON.parse(await readFile(process.argv[2], "utf8"));
if (
  !values ||
  Array.isArray(values) ||
  typeof values !== "object" ||
  Object.values(values).some((value) => typeof value !== "string")
)
  throw new Error("Expected an environment map of strings");
// Only pass secrets to the child environment; never print the supplied map.
const result = spawnSync(
  process.execPath,
  [
    process.env.npm_execpath,
    "run",
    "gate",
    "--",
    process.argv[3] ?? "--phase=1",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, ...values, SKILLED_DOCKER_INTEGRATION: "1" },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
