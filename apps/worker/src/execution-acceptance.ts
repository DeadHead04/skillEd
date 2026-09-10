import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hostname } from "node:os";
import { join } from "node:path";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  rm,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { ExecutionReadinessSchema } from "@skilled/core";
import { CodexAppServer } from "./app-server.js";
import { executeBounded } from "./process.js";

const phase = process.argv[2] ?? "";
if (!process.argv.includes("--real") || !["prepare", "resume"].includes(phase))
  throw new Error(
    "Usage: execution-acceptance.ts prepare|resume --real (consumes model requests)",
  );
const execute = promisify(execFile);
const root = join(
  process.env.WORK_ROOT ?? "/data/work",
  "execution-acceptance",
);
const reportPath =
  process.env.SKILLED_EXECUTION_EVIDENCE ?? "/data/acceptance/acceptance.json";
const statePath = join(root, "state.json");
const model = process.env.SKILLED_MODEL ?? "gpt-5.6-luna";
await mkdir(root, { recursive: true });
await mkdir(join(reportPath, ".."), { recursive: true });
const base = await execute("python3", ["/opt/skilled/isolation-canary.py"], {
  timeout: 120_000,
  maxBuffer: 1024 * 1024,
});
const report = ExecutionReadinessSchema.parse(JSON.parse(base.stdout));
assert.ok(
  report.checks.slice(0, 7).every((check) => check.status === "passed"),
  "Isolation must pass before authentication/model requests",
);
const login = await execute("codex", ["login", "status"], {
  timeout: 10_000,
  maxBuffer: 4096,
});
assert.match(login.stdout + login.stderr, /Logged in/);
type State = {
  imageRevision: string;
  container: string;
  token: string;
  cliThread?: string;
  appThread?: string;
  checks: typeof report.checks;
};
const state: State =
  phase === "prepare"
    ? {
        imageRevision: report.imageRevision,
        container: hostname(),
        token: randomUUID(),
        checks: report.checks,
      }
    : JSON.parse(await readFile(statePath, "utf8"));
assert.equal(
  state.imageRevision,
  report.imageRevision,
  "Image changed since acceptance preparation",
);
for (const check of state.checks.filter((check) => check.status === "passed")) {
  const entry = report.checks.find((item) => item.name === check.name);
  if (entry && report.checks.indexOf(entry) >= 7) Object.assign(entry, check);
}
const save = async () => {
  state.checks = report.checks;
  await writeFile(statePath, JSON.stringify(state, null, 2));
  report.checkedAt = new Date().toISOString();
  report.status = report.checks.every((check) => check.status === "passed")
    ? "ready"
    : "blocked";
  await writeFile(reportPath + ".tmp", JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
  await rename(reportPath + ".tmp", reportPath);
};
const check = async (name: string, operation: () => Promise<string>) => {
  const entry = report.checks.find((check) => check.name === name)!;
  try {
    entry.detail = await operation();
    entry.status = "passed";
    console.log(`${name}: passed`);
  } catch (error) {
    entry.status = "failed";
    entry.detail = String(error).slice(-2000);
    console.error(`${name}: failed — ${entry.detail}`);
  }
  await save();
};
const cliWork = join(root, "cli");
const appWork = join(root, "app");
await mkdir(cliWork, { recursive: true });
await mkdir(appWork, { recursive: true });
async function cli(args: string[], cwd: string) {
  const result = await executeBounded("codex", args, {
    cwd,
    timeoutMs: 180_000,
  });
  assert.equal(result.exitCode, 0, result.stderr.slice(-2000));
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
const schema = {
  type: "object",
  additionalProperties: false,
  properties: { token: { type: "string" }, wrote: { type: "boolean" } },
  required: ["token", "wrote"],
};
const client = new CodexAppServer({ rpc: 30_000, turn: 180_000 });
try {
  if (phase === "prepare") {
    await check("codex_initial", async () => {
      await rm(join(cliWork, "output.txt"), { force: true });
      await writeFile(join(cliWork, "input.txt"), "Docker acceptance input\n");
      const events = await cli(
        [
          "exec",
          "--json",
          "--skip-git-repo-check",
          "--sandbox",
          "workspace-write",
          "-m",
          model,
          `Use a shell command to copy input.txt byte-for-byte to output.txt. Do not only describe the command. Remember this conversation token for a later turn: ${state.token}. Then reply briefly.`,
        ],
        cliWork,
      );
      await writeFile(
        join(root, "cli-initial.json"),
        JSON.stringify(events, null, 2),
      );
      assert.equal(
        await readFile(join(cliWork, "output.txt"), "utf8"),
        "Docker acceptance input\n",
      );
      state.cliThread = events.find(
        (event) => event.type === "thread.started",
      )?.thread_id;
      assert.ok(state.cliThread, "CLI did not return a durable thread ID");
      return "Real pinned CLI used a tool and produced the expected file under the production permission launcher";
    });
    await check("app_server", async () => {
      await rm(join(appWork, "app-output.txt"), { force: true });
      const result = await client.structuredTurn(
        appWork,
        `Use a shell command to write app-output.txt containing exactly docker-app-server. Remember token ${state.token}. Return token and wrote=true using the requested schema.`,
        schema,
      );
      await writeFile(
        join(root, "app-initial.json"),
        JSON.stringify(result, null, 2),
      );
      assert.equal(
        (await readFile(join(appWork, "app-output.txt"), "utf8")).trim(),
        "docker-app-server",
      );
      assert.deepEqual(result.structured, { token: state.token, wrote: true });
      state.appThread = result.threadId;
      return "Actual App Server structuredTurn produced schema-valid output and a real file";
    });
    await client.stop();
    await check("judge_correction", async () => {
      const fixture = join(root, "judge-fixture");
      const proxy = join(root, "fault-proxy");
      await mkdir(join(fixture, "evals/cases"), { recursive: true });
      await mkdir(proxy, { recursive: true });
      await writeFile(
        join(fixture, "SKILL.md"),
        "---\nname: docker-canary\ndescription: Echo the supplied acceptance marker.\n---\nReturn exactly the marker supplied by the user.\n",
      );
      await writeFile(
        join(fixture, "evals/eval.yaml"),
        JSON.stringify({
          schema_version: "v1alpha1",
          environment: { type: "none", workspace_mount: "/workspace" },
          mcp: { servers: [] },
          skills: [{ source: "local_path", path: "." }],
          engine: { name: "codex", model: { name: model } },
          cases: {
            files: ["evals/cases/echo.yaml"],
            defaults: { timeout_seconds: 180, max_turns: 4 },
            parallelism: 1,
          },
          report: { formats: ["json"], artifacts: ["transcript"] },
        }),
      );
      await writeFile(
        join(fixture, "evals/cases/echo.yaml"),
        JSON.stringify({
          id: "echo",
          title: "Real judge recovery",
          input: { prompt: "Reply exactly DOCKER_CANARY_OK." },
          judge: {
            type: "agent_judge",
            model,
            timeout_seconds: 180,
            criteria: [
              "SKILLED_CORRECTION_CANARY: The final response contains DOCKER_CANARY_OK.",
            ],
            pass_threshold: 1,
          },
        }),
      );
      const source = await readFile(
        new URL("./acceptance-fault-proxy.py", import.meta.url),
        "utf8",
      );
      const faultPath = join(proxy, "injected.txt");
      await rm(faultPath, { force: true });
      await writeFile(
        join(proxy, "codex"),
        `#!/usr/bin/env python3\nSTATE_FILE=${JSON.stringify(faultPath)}\n` +
          source,
        { mode: 0o755 },
      );
      const originalPath = process.env.PATH;
      process.env.PATH = proxy + ":" + originalPath;
      try {
        const output = join(root, "judge-output-" + randomUUID());
        const result = await executeBounded(
          "skill-up",
          [
            "run",
            join(fixture, "evals/eval.yaml"),
            "--engine",
            "codex",
            "--model",
            model,
            "--runtime",
            "none",
            "--parallelism",
            "1",
            "--output-dir",
            output,
            "--format",
            "json",
          ],
          { cwd: fixture, timeoutMs: 600_000 },
        );
        assert.equal(result.exitCode, 0, result.stderr.slice(-2000));
        await readFile(faultPath, "utf8");
        const entries = await readdir(output, { recursive: true });
        assert.ok(
          entries.some((name) => name.endsWith("raw-response-attempt-2.txt")),
          "Actual Skill-Up judge did not exercise correction",
        );
        const gradeFiles = entries.filter((name) =>
          name.endsWith("grading.json"),
        );
        assert.ok(gradeFiles.length > 0, "Missing judge grading");
        for (const file of gradeFiles) {
          const grading = JSON.parse(
            await readFile(join(output, file), "utf8"),
          );
          // Skill-Up's disk grading contract uses expectations; debug judge
          // emits a different result envelope with a top-level status.
          assert.equal(grading.expectations?.length, 1);
          assert.equal(grading.expectations[0].passed, true);
          assert.match(
            grading.expectations[0].text,
            /SKILLED_CORRECTION_CANARY/,
          );
          assert.ok(grading.expectations[0].evidence?.length > 0);
          assert.equal(grading.summary?.failed, 0);
        }
        return "Real Skill-Up case and judge recovered from one explicitly injected malformed transport response; second attempt graded PASS";
      } finally {
        process.env.PATH = originalPath;
      }
    });
  } else {
    assert.notEqual(
      hostname(),
      state.container,
      "Resume phase must use a replacement container with the same persistent volumes",
    );
    await check(
      "login_persistence",
      async () =>
        "Official login remains available after container replacement; no credential copying",
    );
    await check("codex_resume", async () => {
      await rm(join(cliWork, "resumed.txt"), { force: true });
      assert.ok(state.cliThread, "Initial CLI acceptance did not pass");
      const events = await cli(
        [
          "exec",
          "resume",
          "--json",
          "--skip-git-repo-check",
          "-m",
          model,
          state.cliThread,
          "Use a shell command to write resumed.txt containing only the conversation token I asked you to remember. Retrieve it from our previous conversation.",
        ],
        cliWork,
      );
      assert.equal(
        (await readFile(join(cliWork, "resumed.txt"), "utf8")).trim(),
        state.token,
      );
      await writeFile(
        join(root, "cli-resumed.json"),
        JSON.stringify(events, null, 2),
      );
      return "Real CLI resumed its durable conversation after container replacement and produced the remembered token";
    });
    await check("conversation_recovery", async () => {
      await rm(join(appWork, "app-resumed.txt"), { force: true });
      assert.ok(state.appThread, "Initial App Server acceptance did not pass");
      const result = await client.structuredTurn(
        appWork,
        "Use a shell command to write app-resumed.txt with the token from our earlier conversation. Return that token and wrote=true.",
        schema,
        state.appThread,
      );
      assert.equal(
        (await readFile(join(appWork, "app-resumed.txt"), "utf8")).trim(),
        state.token,
      );
      assert.equal(
        result.reconstructed,
        false,
        "Expected native conversation recovery",
      );
      const reconstructed = await client.structuredTurn(
        appWork,
        "Return the previous completed conversation token and wrote=false. No file changes are needed.",
        schema,
        randomUUID(),
        {
          recoveryContext: JSON.stringify({
            completedAssistantMessage: { token: state.token },
          }),
        },
      );
      assert.equal(reconstructed.reconstructed, true);
      assert.deepEqual(reconstructed.structured, {
        token: state.token,
        wrote: false,
      });
      return "Actual App Server resumed after replacement and reconstructed a deliberately missing thread from durable completed context";
    });
  }
} finally {
  await client.stop();
  await save();
}
console.log(
  JSON.stringify({
    status: report.status,
    checks: report.checks.map(({ name, status }) => ({ name, status })),
  }),
);
if (report.checks.some((check) => check.status === "failed"))
  process.exitCode = 1;
if (phase === "resume" && report.status !== "ready") process.exitCode = 1;
