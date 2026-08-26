import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const rootEnvironment = resolve(process.cwd(), "../../.env");

if (existsSync(rootEnvironment)) {
  process.loadEnvFile(rootEnvironment);
}

await import("next/dist/bin/next");
