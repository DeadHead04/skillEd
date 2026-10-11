import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(
  root,
  "evidence",
  "runs",
  new Date().toISOString().replaceAll(":", "-"),
);
mkdirSync(output, { recursive: true });
const git = (...args) =>
  spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout?.trim();
const report = {
  startedAt: new Date().toISOString(),
  revision: git("rev-parse", "HEAD"),
  dirty: Boolean(git("status", "--porcelain")),
  host: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  },
  services: {
    docker: process.env.SKILLED_DOCKER_INTEGRATION === "1",
    openSandbox: process.env.SKILLED_REAL_OPENSANDBOX === "1",
    collector: Boolean(process.env.SKILLED_TEST_OTEL_FILE),
  },
  checks: [],
  unverified: [
    "Other native OS/architecture targets are not certified by this host run.",
  ],
};
function run(name, args) {
  const start = Date.now();
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  const log = `${result.stdout || ""}${result.stderr || ""}${result.error ? String(result.error) : ""}`;
  writeFileSync(join(output, `${name}.log`), log);
  process.stdout.write(log);
  const entry = {
    name,
    passed: result.status === 0,
    exitCode: result.status,
    elapsedMs: Date.now() - start,
  };
  report.checks.push(entry);
  return { entry, log };
}
if (!process.env.npm_execpath)
  throw new Error("Run through npm run gate:phase1.");
for (const task of ["typecheck", "build", "audit:brand"]) {
  if (!run(task, [process.env.npm_execpath, "run", task]).entry.passed) break;
}
if (report.checks.every((c) => c.passed)) {
  const { log, entry } = run("real-tests", [
    "--test",
    "--test-reporter=tap",
    "--test-concurrency=1",
    "dist/tests/**/*.test.js",
  ]);
  entry.tests = Number(log.match(/^# tests (\d+)$/m)?.[1] || 0);
  entry.passedTests = Number(log.match(/^# pass (\d+)$/m)?.[1] || 0);
  entry.skippedTests = Number(log.match(/^# skipped (\d+)$/m)?.[1] || 0);
  if (!entry.tests) entry.passed = false;
  for (const line of log.split("\n").filter((line) => /# SKIP/.test(line)))
    report.unverified.push(line.trim());
}
for (const [name, enabled] of Object.entries(report.services))
  if (!enabled)
    report.unverified.push(`${name}: live service tests not enabled`);
report.finishedAt = new Date().toISOString();
report.status = report.checks.every((c) => c.passed)
  ? "available_checks_passed"
  : "failed";
report.scope =
  "Phase 1 foundations; this does not certify the later evaluation CLI or release targets.";
writeFileSync(
  join(output, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(`Phase 1 evidence: ${output}/report.json`);
process.exitCode = report.status === "failed" ? 1 : 0;
