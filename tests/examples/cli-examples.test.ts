import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = resolve(".");
async function isolated<T>(
  fn: (dir: string, env: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "skilled-examples-"));
  await mkdir(join(dir, "home"));
  try {
    return await fn(dir, {
      PATH: process.env.PATH,
      HOME: join(dir, "home"),
      USERPROFILE: join(dir, "home"),
      XDG_CONFIG_HOME: join(dir, "home"),
      DASHSCOPE_API_KEY: "validation-only-no-model-calls",
      DASHSCOPE_EVAL_API_KEY: "validation-only-no-model-calls",
      SIMULATION_API_KEY: "validation-only-no-model-calls",
      SIMULATION_BASE_URL: "https://example.invalid/v1",
      DSH_SKILLED_NODE: process.execPath,
      DSH_SKILLED_RUNNER: resolve(
        "dist/examples/deepseek-harness/evals/fixtures/dsh_runner.js",
      ),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
function cli(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(
    process.execPath,
    [join(root, "dist/src/bootstrap.js"), ...args],
    { cwd: root, env, encoding: "utf8", timeout: 30_000 },
  );
}
for (const [name, count] of [
  ["hello-world", 1],
  ["code-stats", 4],
  ["deepseek-harness", 1],
  ["user-simulator", 2],
] as const) {
  test(`real example ${name}: validate, list and dry run without model calls`, async () =>
    isolated(async (_dir, env) => {
      const file = `examples/${name}/evals/eval.yaml`;
      const valid = cli(["validate", file], env);
      assert.equal(valid.status, 0, valid.stdout + valid.stderr);
      assert.match(valid.stdout, new RegExp(`loaded ${count} case`));
      const listed = cli(["list-cases", file], env);
      assert.equal(listed.status, 0, listed.stdout + listed.stderr);
      const dry = cli(["run", file, "--dry-run"], env);
      assert.equal(dry.status, 0, dry.stdout + dry.stderr);
      assert.match(dry.stdout, /Would run/);
    }));
}
test("Anthropic simulator example validates without an authenticated call", async () =>
  isolated(async (_dir, env) => {
    const result = cli(
      ["validate", "examples/user-simulator/evals/eval-anthropic.yaml"],
      env,
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }));
for (const [file, pass] of [
  ["judge-debug-demo.json", true],
  ["judge-debug-fail.json", false],
  ["judge-debug-script.json", true],
] as const) {
  test(`real debug judge fixture ${file}`, async () =>
    isolated(async (dir, env) => {
      const output = join(dir, "grading.json");
      const result = cli(
        ["debug", "judge", `examples/${file}`, "--output", output],
        env,
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const grading = JSON.parse(await readFile(output, "utf8"));
      assert.equal(grading.summary.pass_rate, pass ? 1 : 0);
      if (file.includes("script"))
        assert.match(JSON.stringify(grading), /identified the bug/);
    }));
}
test("real report example generates JSON, JUnit, HTML and Markdown", async () =>
  isolated(async (dir, env) => {
    const result = cli(
      [
        "report",
        "examples/report-debug-demo.json",
        "--output-dir",
        dir,
        "--format",
        "json",
        "--format",
        "junit",
        "--format",
        "html",
        "--format",
        "markdown",
      ],
      env,
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const file of [
      "report.json",
      "report.xml",
      "report.html",
      "report.md",
    ])
      assert((await readFile(join(dir, file), "utf8")).length > 50, file);
  }));
test("preserved Go sample input still has its expected three files and twenty lines", async () => {
  const base = "examples/code-stats/evals/fixtures/repos/sample-project";
  const texts = await Promise.all(
    ["main.go", "util.go", "README.md"].map((file) =>
      readFile(join(base, file), "utf8"),
    ),
  );
  assert.equal(
    texts.reduce((n, s) => n + (s.match(/\n/g) || []).length, 0),
    20,
  );
});
test("proposal helper creates a real rebranded document from retained template", async () =>
  isolated(async (dir, env) => {
    const output = join(dir, "proposal.md");
    const result = spawnSync(
      "bash",
      [
        resolve("proposals/init-proposal.sh"),
        "--author",
        "Example author",
        "--status",
        "draft",
        "--output",
        output,
        "Document verification",
      ],
      { cwd: root, env, encoding: "utf8", timeout: 10_000 },
    );
    assert.equal(result.status, 0, result.stderr);
    const text = await readFile(output, "utf8");
    assert.match(text, /Document verification/);
    assert.match(text, /Example author/);
    assert.match(text, /skilled/i);
  }));
