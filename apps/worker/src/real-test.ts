import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { requireExecutionReady } from "./readiness.js";
await requireExecutionReady();
const mode = process.env.SKILLED_REAL_MODE ?? "smoke";
const args = [
  "run",
  resolve(process.env.SKILLED_REAL_EVAL ?? "evals/eval.yaml"),
  "--engine",
  "codex",
  "--parallelism",
  "1",
];
if (mode === "full") args.push("--baseline", "--iteration", "3");
console.log(`Running explicit real-agent evidence suite: ${mode}`);
const child = spawn(process.env.SKILL_UP_BIN ?? "skill-up", args, {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
