import { executeArgs } from "../../src/cli/root.js";
try {
  await executeArgs("phase4-test", process.argv.slice(2));
} catch {
  process.exitCode = 1;
}
