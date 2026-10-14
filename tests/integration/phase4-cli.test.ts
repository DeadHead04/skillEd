import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  symlink,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const cli = fileURLToPath(new URL("../../src/bootstrap.js", import.meta.url));
const source = JSON.parse(
  await readFile(
    new URL("../../../tests/integration/phase3/config.json", import.meta.url),
    "utf8",
  ),
);
const reference = JSON.parse(
  await readFile(
    new URL(
      "../../../tests/integration/phase4/reference-run.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
function normalize(value: any): any {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) =>
            ![
              "duration_ms",
              "judge_duration_ms",
              "start_time",
              "end_time",
              "elapsed_ms",
              "time",
              "invocation_id",
              "scoring_version",
              "rubric_id",
            ].includes(k) && !(k === "id" && "passed" in value && "text" in value),
        )
        .map(([k, v]) => [k, normalize(v)]),
    );
  return value;
}
async function setup(t: test.TestContext, runtime = "none") {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "skilled-full-cli-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "home"));
  await mkdir(path.join(root, "evals/cases"), { recursive: true });
  await writeFile(
    path.join(root, "SKILL.md"),
    "---\nname: skilled-improve\ndescription: Real test\n---\nCompute hashes.\n",
  );
  const spec = structuredClone(source);
  spec.cases.sort((a: any, b: any) => a.id.localeCompare(b.id));
  spec.eval.cases.files = spec.cases.map(
    (c: any) => `evals/cases/${c.id}.yaml`,
  );
  spec.eval.environment.type = runtime;
  if (runtime !== "none")
    Object.assign(spec.eval.environment, {
      image: "node:22",
      sandbox_timeout_seconds: 300,
      ready_timeout_seconds: 90,
    });
  if (runtime === "opensandbox")
    Object.assign(spec.eval.environment, {
      use_server_proxy: process.env.SKILLED_REAL_OPENSANDBOX_PROXY === "1",
      kwargs: {
        base_url: process.env.SKILLED_REAL_OPENSANDBOX_BASE_URL,
        request_timeout_seconds: "60",
      },
    });
  const config = path.join(root, "evals/eval.yaml");
  await writeFile(config, JSON.stringify(spec.eval));
  for (const c of spec.cases)
    await writeFile(
      path.join(root, "evals/cases", c.id + ".yaml"),
      JSON.stringify(c),
    );
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: path.join(root, "home"),
    USERPROFILE: path.join(root, "home"),
    OTEL_SDK_DISABLED: "true",
  };
  for (const key of [
    "TMPDIR",
    "SYSTEMROOT",
    "COMSPEC",
    "OPENSANDBOX_API_KEY",
    "OPENSANDBOX_BASE_URL",
  ])
    if (process.env[key]) env[key] = process.env[key];
  const run = (args: string[], cwd = root) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(process.execPath, [cli, ...args], {
          cwd,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (data) => (stdout += data));
        child.stderr.on("data", (data) => (stderr += data));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
      },
    );
  return { root, config, spec, env, run };
}
for (const runtime of ["none", "docker", "opensandbox"])
  test(
    runtime === "docker"
      ? "complete Docker CLI matches reference verdicts, reports and 57 lifecycle transitions"
      : `${runtime} CLI refuses a benchmark without a verified isolation boundary`,
    {
      skip:
        runtime === "docker"
          ? process.env.SKILLED_DOCKER_INTEGRATION !== "1"
          : runtime === "opensandbox"
            ? process.env.SKILLED_REAL_OPENSANDBOX !== "1"
            : false,
      timeout: 300_000,
    },
    async (t) => {
      const { root, config, run } = await setup(t, runtime),
        output = path.join(root, "output"),
        events = path.join(root, "events.jsonl");
      const result = await run([
        "run",
        config,
        "--output-dir",
        output,
        "--baseline",
        "--iteration",
        "2",
        "--format",
        "json",
        "--format",
        "junit",
        "--format",
        "html",
        "--event-log",
        events,
      ]);
      if (runtime !== "docker") {
        assert.equal(result.code, 1);
        assert.match(result.stderr, /benchmark requires the verified isolated runtime/);
        assert.ok(!(await readdir(root)).includes("output"), "unsafe benchmark must not create report output");
        return;
      }
      assert.equal(
        result.code,
        reference.exit_code,
        result.stdout + result.stderr,
      );
      assert.match(result.stderr, /one or more cases failed/);
      for (let i = 1; i <= 2; i++) {
        const directory = path.join(output, `iteration-${i}`),
          report = JSON.parse(
            await readFile(path.join(directory, "report.json"), "utf8"),
          );
        assert.deepEqual(normalize(report), reference.reports[i - 1]);
        assert.match(
          await readFile(path.join(directory, "report.xml"), "utf8"),
          /tests="3"/,
        );
        assert.match(
          await readFile(path.join(directory, "report.html"), "utf8"),
          /skilled-improve/,
        );
        for (const c of report.case_results) {
          const parts = [
            directory,
            c.case_id,
            c.configuration,
            "outputs/agent/run",
          ];
          if (c.case_id === "hash-multiturn") parts.push("turn-2");
          assert.equal(
            await readFile(path.join(...parts, "digest.txt"), "utf8"),
            c.response,
          );
            assert.equal(
              await readFile(
                path.join(
                  directory,
                  c.case_id,
                  c.configuration,
                  "outputs/workspace/results/digest.txt",
                ),
                "utf8",
              ),
              c.response,
            );
        }
      }
      const records = (await readFile(events, "utf8"))
        .trim()
        .split("\n")
        .map((x) => JSON.parse(x));
      const transitions: any[] = [];
      for (const [index, record] of records.entries()) {
        assert.equal(
          record.sequence_number,
          index + 1,
          "every event has contiguous sequence numbers",
        );
        const current = normalize(record),
          previous = transitions.at(-1);
        // Both implementations publish a 30-second wall-clock heartbeat. Slow
        // sandbox provisioning can add unchanged progress snapshots to this run.
        if (
          current.event === "run_progress" &&
          previous?.event === "run_progress" &&
          JSON.stringify(current.payload) === JSON.stringify(previous.payload)
        )
          continue;
        transitions.push({
          ...current,
          sequence_number: transitions.length + 1,
        });
      }
      assert.deepEqual(transitions, reference.events);
      if (records.length > transitions.length)
        t.diagnostic(
          `${records.length - transitions.length} unchanged wall-clock heartbeat snapshots validated separately from lifecycle transitions`,
        );
      assert.equal(records.at(-1).payload.status, "COMPLETED");
    },
  );
test("CLI discovery, selected-case validation, dry-run, aliases, explicit boolean values and append", async (t) => {
  const { root, config, spec, run } = await setup(t);
  const bad = structuredClone(spec.cases[0]);
  bad.id = "invalid-unselected";
  bad.input = {};
  await writeFile(
    path.join(root, "evals/cases/invalid.yaml"),
    JSON.stringify(bad),
  );
  spec.eval.cases.files.push("evals/cases/invalid.yaml");
  await writeFile(config, JSON.stringify(spec.eval));
  assert.equal((await run(["validate", config])).code, 1);
  await mkdir(path.join(root, "deep/child"), { recursive: true });
  const dry = await run(
    [
      "run",
      "--dry-run",
      "--include-case-name",
      "hash-p*",
      "--rk",
      "example=one=two",
      "--ek",
      "trace=true",
      "--baseline=false",
      "--verbose=false",
    ],
    path.join(root, "deep/child"),
  );
  assert.equal(dry.code, 0, dry.stderr);
  assert.match(dry.stdout, /Would run 1 case\(s\)/);
  assert.doesNotMatch(dry.stdout, /Loading credentials/);
  const output = path.join(root, "out");
  for (let i = 1; i <= 2; i++) {
    const result = await run([
      "run",
      config,
      "--include-case-name",
      "hash-p*",
      "--dry-run=false",
      "--output-dir",
      output,
      "--no-delete=false",
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      JSON.parse(
        await readFile(path.join(output, `iteration-${i}/report.json`), "utf8"),
      ).case_results.length,
      1,
    );
  }
  assert.deepEqual((await readdir(output)).sort(), [
    "iteration-1",
    "iteration-2",
  ]);
});
test("CLI rejects invalid execution overrides and event options without creating output", async (t) => {
  const { root, config, run } = await setup(t);
  const matrix: [string[], RegExp][] = [
    [["--parallelism", "0"], /must be >= 1/],
    [["--parallelism", "257"], /must be <= 256/],
    [["--iteration", "-1"], /must be >= 0/],
    [["--format", "markdown"], /unsupported --format/],
    [["--runtime", "bad"], /invalid --runtime/],
    [["--rk", "missing"], /expected key=value/],
    [["--ek", "=bad"], /expected key=value/],
    [["--event-log", "-"], /does not support stdout/],
    [["--event-attribute", "team.task=x"], /requires --event-log/],
    [
      [
        "--event-log",
        path.join(root, "a.jsonl"),
        "--event-attribute",
        "team.task=x",
        "--event-attribute",
        "team.task=y",
      ],
      /duplicate/,
    ],
    [
      ["--event-log", path.join(root, "a.jsonl"), "--dry-run"],
      /cannot be used with --dry-run/,
    ],
  ];
  for (const [flags, expected] of matrix) {
    const r = await run([
      "run",
      config,
      "--output-dir",
      path.join(root, "out"),
      ...flags,
    ]);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stderr, expected);
  }
  await assert.rejects(readdir(path.join(root, "out")), { code: "ENOENT" });
});
test("CLI event destination overlap resolves symlinks and preserves existing files", async (t) => {
  const { root, config, run } = await setup(t),
    output = path.join(root, "output");
  await mkdir(path.join(output, "iteration-1"), { recursive: true });
  const sentinel = path.join(output, "iteration-1/events.jsonl");
  await writeFile(sentinel, "preserve");
  await symlink(path.join(output, "iteration-1"), path.join(root, "alias"));
  const r = await run([
    "run",
    config,
    "--output-dir",
    output,
    "--iteration",
    "1",
    "--event-log",
    path.join(root, "alias/events.jsonl"),
  ]);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /scheduled iteration directory/);
  assert.equal(await readFile(sentinel, "utf8"), "preserve");
});
test("CLI catches actual engine failure while finalizing ERROR case and COMPLETED invocation", async (t) => {
  const { root, config, spec, run } = await setup(t);
  spec.eval.engine.custom.local.command =
    "skilled-definitely-missing-executable";
  await writeFile(config, JSON.stringify(spec.eval));
  const output = path.join(root, "out"),
    events = path.join(root, "events.jsonl");
  const r = await run([
    "run",
    config,
    "--include-case-name",
    "hash-pass",
    "--output-dir",
    output,
    "--event-log",
    events,
  ]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /one or more cases errored/);
  assert.match(r.stderr, /\[ERROR\] case hash-pass/);
  const report = JSON.parse(
    await readFile(path.join(output, "iteration-1/report.json"), "utf8"),
  );
  assert.equal(report.case_results[0].status, "ERROR");
  const records = (await readFile(events, "utf8"))
    .trim()
    .split("\n")
    .map((x) => JSON.parse(x));
  assert.equal(records.at(-1).event, "run_finished");
  assert.equal(records.at(-1).payload.errored, 1);
});
test(
  "CLI signal cancellation writes final CANCELLED event and cleans real child process",
  { timeout: 20_000 },
  async (t) => {
    const { root, config, spec, env } = await setup(t);
    const c = spec.cases.find((x: any) => x.id === "hash-pass");
    c.context.files["engine.cjs"] =
      `require('node:fs').writeFileSync(${JSON.stringify(path.join(root, "started"))},String(process.pid));setInterval(()=>{},1000);`;
    await writeFile(
      path.join(root, "evals/cases/hash-pass.yaml"),
      JSON.stringify(c),
    );
    const events = path.join(root, "events.jsonl"),
      child = spawn(
        process.execPath,
        [
          cli,
          "run",
          config,
          "--include-case-name",
          "hash-pass",
          "--output-dir",
          path.join(root, "out"),
          "--event-log",
          events,
        ],
        { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
      );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const done = new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    t.after(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    });
    const until = Date.now() + 10_000;
    let pid = 0;
    while (Date.now() < until) {
      try {
        pid = Number(await readFile(path.join(root, "started"), "utf8"));
        break;
      } catch {}
      await new Promise((r) => setTimeout(r, 20));
    }
    assert(pid > 0, stdout + stderr);
    child.kill("SIGTERM");
    assert.equal(await done, 1, stdout + stderr);
    const records = (await readFile(events, "utf8"))
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    assert.equal(records.at(-1).payload.status, "CANCELLED");
    assert.equal(records.at(-1).last_event, true);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  },
);
