import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as action from "../../action/main.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const compiledMain = path.join(root, "dist/action/main.js"),
  bootstrap = path.join(root, "dist/src/bootstrap.js");
const reference = JSON.parse(
  await readFile(
    path.join(root, "tests/action/reference-helpers.json"),
    "utf8",
  ),
) as {
  vectors: {
    name: keyof typeof action;
    args: unknown[];
    value?: unknown;
    error?: string;
  }[];
};
for (const [index, v] of reference.vectors.entries())
  test(`original Python helper ${index}: ${v.name}`, () => {
    const fn = action[v.name] as (...args: unknown[]) => unknown;
    if (v.error) assert.throws(() => fn(...v.args));
    else assert.deepEqual(fn(...v.args), v.value);
  });
async function temp(t: {
  after: (f: () => Promise<void>) => void;
}): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "skilled-action-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function invoke(
  argv: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: cwd,
        OTEL_TRACES_EXPORTER: "none",
        OTEL_METRICS_EXPORTER: "none",
        ...env,
      },
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
async function fixture(dir: string, passing = true): Promise<void> {
  await mkdir(path.join(dir, "evals/cases"), { recursive: true });
  await writeFile(
    path.join(dir, "SKILL.md"),
    "---\nname: action-hash\n---\nActual local SHA256 skill.\n",
  );
  const worker = await readFile(
    path.join(root, "tests/integration/phase3/worker.cjs"),
    "utf8",
  );
  await writeFile(
    path.join(dir, "evals/eval.yaml"),
    JSON.stringify({
      schema_version: "v1alpha1",
      environment: { type: "none" },
      engine: {
        name: "hash-worker",
        custom: {
          transport: "local",
          response_format: "session_result",
          local: { command: "node", args: ["engine.cjs", "${input_file}"] },
        },
      },
      cases: { files: ["evals/cases/hash.yaml"] },
      judge: {
        type: "rule_based",
        success: [
          {
            output_contains: {
              all: [
                passing
                  ? createHash("sha256")
                      .update("action real input")
                      .digest("hex")
                  : "must fail",
              ],
            },
          },
        ],
      },
      report: { formats: ["json", "html", "junit"], artifacts: ["transcript"] },
    }),
  );
  await writeFile(
    path.join(dir, "evals/cases/hash.yaml"),
    JSON.stringify({
      id: "actual-hash",
      title: "Actual hash",
      input: { prompt: "action real input" },
      context: { files: { "engine.cjs": worker } },
      constraints: { timeout_seconds: 30, max_turns: 1 },
    }),
  );
}
async function installLocalLauncher(dir: string): Promise<string> {
  const bin = path.join(dir, "bin");
  await mkdir(bin);
  await writeFile(
    path.join(bin, "skilled"),
    `#!/bin/sh\nexec ${action.shellQuote(process.execPath)} ${action.shellQuote(bootstrap)} "$@"\n`,
    { mode: 0o700 },
  );
  return bin;
}
for (const passing of [true, false])
  test(`real action subprocess propagates ${passing ? "PASS" : "FAIL"}, reports and GitHub outputs`, async (t) => {
    const dir = await temp(t);
    await fixture(dir, passing);
    const bin = await installLocalLauncher(dir),
      githubOutput = path.join(dir, "github-output");
    const out = await invoke(
      [
        process.execPath,
        compiledMain,
        "--skill-target",
        "evals/eval.yaml",
        "--api-key",
        "action-local-secret",
      ],
      dir,
      {
        PATH: bin + path.delimiter + process.env.PATH,
        GITHUB_WORKSPACE: dir,
        GITHUB_OUTPUT: githubOutput,
      },
    );
    assert.equal(out.code, passing ? 0 : 1, out.stdout + out.stderr);
    assert.doesNotMatch(out.stdout + out.stderr, /action-local-secret/);
    assert.match(out.stdout, /--api-key '\*\*\*'/);
    const folder = path.join(dir, "skilled-workspace"),
      report = JSON.parse(
        await readFile(path.join(folder, "iteration-1/report.json"), "utf8"),
      );
    assert.equal(report.case_results[0].status, passing ? "PASS" : "FAIL");
    assert.ok(
      (await stat(path.join(folder, "iteration-1/report.xml"))).size > 0,
    );
    assert.ok(
      (await stat(path.join(folder, "iteration-1/report.html"))).size > 0,
    );
    assert.equal(
      await readFile(path.join(folder, "skilled-exit-code"), "utf8"),
      passing ? "0" : "1",
    );
    assert.equal(
      await readFile(githubOutput, "utf8"),
      `exit-code=${passing ? 0 : 1}\nreport-dir=skilled-workspace\n`,
    );
  });
test("action detects current candidate capabilities with real CLI despite reset version numbering", async (t) => {
  const dir = await temp(t),
    bin = await installLocalLauncher(dir),
    env = { PATH: bin + path.delimiter + process.env.PATH, HOME: dir };
  assert.equal(
    await action.commandSupportsFlag("skilled run", "--engine-kwarg", env),
    true,
  );
  assert.equal(
    await action.commandSupportsExplicitProvider("skilled run", env),
    true,
  );
  assert.equal(await action.getSkilledVersion(env), null);
});
test("action rejects unknown engine before running evaluation", async (t) => {
  const dir = await temp(t);
  const out = await invoke(
    [process.execPath, compiledMain, "--engine", "not-an-engine"],
    dir,
  );
  assert.equal(out.code, 2);
  assert.match(out.stderr, /unknown engine/);
});
test(
  "real Docker action runs full CLI, restores mounted report permissions and emits outputs",
  {
    skip:
      process.env.SKILLED_ACTION_DOCKER_INTEGRATION !== "1"
        ? "enable SKILLED_ACTION_DOCKER_INTEGRATION=1 for actual action image"
        : false,
    timeout: 180000,
  },
  async (t) => {
    const dir = await temp(t);
    await fixture(dir);
    await writeFile(path.join(dir, "github-output"), "");
    const image =
      process.env.SKILLED_ACTION_IMAGE || "skilled-phase5-action:local";
    const out = await invoke(
      [
        "docker",
        "run",
        "--rm",
        "--network",
        "none",
        "-v",
        `${dir}:/github/workspace`,
        "-e",
        "GITHUB_WORKSPACE=/github/workspace",
        "-e",
        "GITHUB_OUTPUT=/github/workspace/github-output",
        "-e",
        "OTEL_TRACES_EXPORTER=none",
        "-e",
        "OTEL_METRICS_EXPORTER=none",
        image,
        "--skill-target",
        "evals/eval.yaml",
      ],
      dir,
    );
    assert.equal(out.code, 0, out.stdout + out.stderr);
    const report = path.join(dir, "skilled-workspace/iteration-1/report.json");
    assert.equal(
      JSON.parse(await readFile(report, "utf8")).case_results[0].status,
      "PASS",
    );
    const info = await stat(report),
      owner = await stat(dir);
    assert.equal(info.uid, owner.uid);
    assert.equal(info.gid, owner.gid);
    assert.ok((info.mode & 0o444) === 0o444);
    assert.match(
      await readFile(path.join(dir, "github-output"), "utf8"),
      /exit-code=0/,
    );
  },
);

for (const installExit of [0, 7])
  test(`action runs an actual custom installer and propagates status ${installExit}`, async (t) => {
    const dir = await temp(t);
    await fixture(dir);
    const bin = await installLocalLauncher(dir);
    const out = await invoke(
      [
        process.execPath,
        compiledMain,
        "--skill-target",
        "evals/eval.yaml",
        "--agent-install-command",
        `printf 'installed' > actual-install-marker; exit ${installExit}`,
      ],
      dir,
      { PATH: bin + path.delimiter + process.env.PATH, GITHUB_WORKSPACE: dir },
    );
    assert.equal(out.code, installExit, out.stdout + out.stderr);
    assert.equal(
      await readFile(path.join(dir, "actual-install-marker"), "utf8"),
      "installed",
    );
    if (installExit)
      await assert.rejects(stat(path.join(dir, "skilled-workspace")));
    else
      assert.ok(
        (
          await stat(
            path.join(dir, "skilled-workspace/iteration-1/report.json"),
          )
        ).size > 0,
      );
  });

test("executable lookup does not accept a same-named directory on PATH", async (t) => {
  const dir = await temp(t);
  await mkdir(path.join(dir, "skilled"));
  assert.equal(await action.which("skilled", { PATH: dir }), undefined);
});
