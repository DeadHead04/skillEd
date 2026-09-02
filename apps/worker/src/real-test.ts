import { spawn } from "node:child_process";
const mode = process.env.SKILLED_REAL_MODE ?? "smoke";
const args = [
  "run",
  process.env.SKILLED_REAL_EVAL ?? "evals/eval.yaml",
  "--engine",
  "codex",
  "--parallelism",
  "1",
];
if (mode === "full") args.push("--baseline", "--iterations", "3");
console.log(`Running explicit real-agent evidence suite: ${mode}`);
const child = spawn(process.env.SKILL_UP_BIN ?? "skill-up", args, {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
