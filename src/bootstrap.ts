#!/usr/bin/env node
// Modified for the skilled TypeScript distribution.
import { VERSION } from "./brand.js";
import { execute } from "./api/index.js";
try {
  await execute(VERSION, process.argv.slice(2));
} catch {
  process.exitCode = 1;
}
