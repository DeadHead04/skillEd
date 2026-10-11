import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const phase = Number(
  process.argv.find((arg) => arg.startsWith("--phase="))?.split("=")[1] || 2,
);
if (![1, 2, 3, 4, 5].includes(phase))
  throw new Error("Expected --phase=1 through --phase=5");
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
  phase,
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
  liveModelChecksEnabled: process.env.SKILLED_REAL_MODELS === "1",
  engineInstallChecksEnabled:
    process.env.SKILLED_ENGINE_INSTALL_INTEGRATION === "1",
  browserChecksEnabled: process.env.SKILLED_BROWSER_INTEGRATION === "1",
  distributionChecks: {
    installer: process.env.SKILLED_INSTALLER_INTEGRATION === "1",
    npm: process.env.SKILLED_DISTRIBUTION_INTEGRATION === "1",
    actionDocker: process.env.SKILLED_ACTION_DOCKER_INTEGRATION === "1",
  },
  pluginChecks: {
    cli: process.env.SKILLED_PLUGIN_CLI_INTEGRATION === "1",
    codexHost: process.env.SKILLED_CODEX_PLUGIN_HOST_INTEGRATION === "1",
    dshHost: Boolean(process.env.SKILLED_DSH_PLUGIN_HOST_ROOT),
    workflowRegression:
      process.env.SKILLED_WORKFLOW_REGRESSION_INTEGRATION === "1",
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
  // Evidence must also be uploadable and extractable on Windows.
  const logName = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-");
  writeFileSync(join(output, `${logName}.log`), log);
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
  throw new Error("Run through npm run gate -- --phase=2.");
for (const task of [
  "typecheck",
  "build",
  ...(phase >= 5 ? ["docs:build"] : []),
  "audit:brand",
]) {
  if (!run(task, [process.env.npm_execpath, "run", task]).entry.passed) break;
}
if (report.checks.every((c) => c.passed)) {
  const files = readdirSync(join(root, "dist/tests"), {
    recursive: true,
  }).filter((name) => name.endsWith(".test.js"));
  const level = {
    config: 1,
    events: 1,
    runtime: 1,
    agent: 2,
    mcp: 2,
    judge: 3,
    evaluator: 3,
    report: 3,
    usersimulator: 3,
    runner: 4,
    cli: 4,
    plugins: 4,
    action: 5,
    distribution: 5,
    examples: 5,
  };
  report.testFiles = files
    .filter((name) => {
      const folder = name.split(/[\\/]/)[0];
      if (folder === "integration")
        return (
          !/phase([2-5])/.test(name) ||
          Number(name.match(/phase([2-5])/)?.[1]) <= phase
        );
      if (!level[folder])
        throw new Error(`Unassigned test directory: ${folder}`);
      return level[folder] <= phase;
    })
    .sort()
    .map((name) => join("dist/tests", name));
  const { log, entry } = run("real-tests", [
    "--test",
    "--test-reporter=tap",
    "--test-concurrency=1",
    ...report.testFiles,
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
if (phase >= 2 && !report.liveModelChecksEnabled)
  report.unverified.push(
    "Authenticated model-backed engine/judge/simulator tests are not enabled; parser and local transport checks do not certify them.",
  );
if (phase >= 3)
  report.unverified.push(
    "OpenSandbox glob artifact collection is not certified with tested execd 1.0.16: stdout line separators are lost in both original Go and TypeScript. Direct downloads and case/report parity are tested; see docs/verification.md.",
  );
report.finishedAt = new Date().toISOString();
report.status = report.checks.every((c) => c.passed)
  ? "available_checks_passed"
  : "failed";
report.scope = `Cumulative phases 1–${phase}. ${phase < 4 ? "Full evaluation CLI and hosted release remain later phases." : phase === 4 ? "CLI and plugins integrated; hosted release remains Phase 5." : "Candidate distribution verification; external publication and platform limits are recorded explicitly."}`;
writeFileSync(
  join(output, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(`Phase ${phase} evidence: ${output}/report.json`);
process.exitCode = report.status === "failed" ? 1 : 0;
