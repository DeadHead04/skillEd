import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import * as runner from "../../examples/deepseek-harness/evals/fixtures/dsh_runner.js";
const fixtures = JSON.parse(
  await readFile("tests/examples/fixtures/dsh-reference.json", "utf8"),
) as { op: string; args: any[]; expected?: unknown; error?: string }[];
const original = {
  DSH_API_KEY: process.env.DSH_API_KEY,
  DASHSCOPE_EVAL_API_KEY: process.env.DASHSCOPE_EVAL_API_KEY,
};
test.before(() => {
  process.env.DSH_API_KEY = "fixture-secret-one";
  process.env.DASHSCOPE_EVAL_API_KEY = "fixture-secret-two";
});
test.after(() => {
  for (const [k, v] of Object.entries(original)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
for (const [i, row] of fixtures.entries())
  test(`DSH original Python vector ${i + 1}: ${row.op}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "skilled-dsh-vector-"));
    try {
      const run = async () => {
        if (row.op === "readSession") {
          let file: string | null = null;
          if (row.args[0] !== null) {
            file = join(root, "session.jsonl");
            await writeFile(
              file,
              "invalid json\n" +
                row.args[0]
                  .map((e: unknown) => JSON.stringify(e) + "\n")
                  .join(""),
            );
          }
          return runner.readSession(file, row.args[1], row.args[2]);
        }
        const fn = (
          runner as unknown as Record<string, (...args: any[]) => unknown>
        )[row.op];
        return fn(...row.args);
      };
      if (row.error) await assert.rejects(run, { message: row.error });
      else assert.deepEqual(await run(), row.expected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
test("DSH configuration and byte artifact redaction use real files", async () => {
  const root = await mkdtemp(join(tmpdir(), "skilled-dsh-files-"));
  try {
    const skills = join(root, "skills");
    await mkdir(skills);
    await runner.writeDshConfig(root, join(root, "sessions"), skills);
    const patch = await readFile(join(root, "cordis.patch.yml"), "utf8"),
      settings = await readFile(join(root, "settings.yaml"), "utf8");
    assert.match(patch, /provider: skilled-openai/);
    assert.match(patch, /includeDefaultRoots: false/);
    assert.match(patch, /session-title-llm\n  disabled: true/);
    assert.match(settings, /apiKeyEnv: DSH_API_KEY/);
    assert.doesNotMatch(settings, /fixture-secret/);
    await writeFile(
      join(root, "binary"),
      Buffer.concat([
        Buffer.from([0, 255]),
        Buffer.from("fixture-secret-one fixture-secret-two"),
        Buffer.from([1, 254]),
      ]),
    );
    await runner.sanitizeRunArtifacts(root);
    assert.deepEqual(
      await readFile(join(root, "binary")),
      Buffer.concat([
        Buffer.from([0, 255]),
        Buffer.from("[REDACTED] [REDACTED]"),
        Buffer.from([1, 254]),
      ]),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("DSH transport reports actual non-protocol executable failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "skilled-dsh-invalid-"));
  try {
    const result = await runner.runDshAcp(
      [
        process.execPath,
        "-e",
        'console.log("actual command diagnostic");process.stdin.resume()',
      ],
      root,
      { PATH: process.env.PATH },
      2,
      "hello",
      "",
    );
    assert.equal(result[0], 1);
    assert.equal(result[3], false);
    assert.match(result[2], /non-JSON stdout: actual command diagnostic/);
    assert.equal(result[5][0].frame.method, "initialize");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test(
  "DSH transport timeout terminates a real process group",
  { timeout: 10_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "skilled-dsh-timeout-"));
    try {
      const pidFile = join(root, "pid");
      const code = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`;
      const result = await runner.runDshAcp(
        [process.execPath, "-e", code],
        root,
        { PATH: process.env.PATH },
        0.3,
        "hello",
        "",
      );
      assert.equal(result[0], 124);
      assert.equal(result[3], true);
      assert.match(result[2], /initialize timed out/);
      const pid = Number(await readFile(pidFile, "utf8"));
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test("DSH wrapper writes structured errors and redacted artifacts for a real failing command", async () => {
  const root = await mkdtemp(join(tmpdir(), "skilled-dsh-wrapper-"));
  try {
    const input = join(root, "input.json"),
      output = join(root, "output/result.json");
    await writeFile(
      input,
      JSON.stringify({
        workspace: root,
        case_id: "failure-test",
        variant: "with_skill",
        messages: [{ role: "user", content: "hello fixture-secret-one" }],
        timeout_seconds: 3,
      }),
    );
    const result = spawnSync(
      process.execPath,
      [
        resolve("dist/examples/deepseek-harness/evals/fixtures/dsh_runner.js"),
        "--input",
        input,
        "--output",
        output,
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          PATH: process.env.PATH,
          DSH_BIN: process.execPath,
          DSH_API_KEY: "fixture-secret-one",
          DASHSCOPE_EVAL_API_KEY: "fixture-secret-two",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const document = JSON.parse(await readFile(output, "utf8"));
    assert.equal(document.engine, "deepseek-harness");
    assert.equal(document.exit_code, 1);
    assert.equal(document.session_id, "");
    assert.match(document.stderr, /ACP exited/);
    assert.equal(document.artifacts.generated_files.length, 4);
    assert.doesNotMatch(JSON.stringify(document), /fixture-secret/);
    for (const path of document.artifacts.generated_files) {
      assert(path.startsWith(".skilled-dsh/"));
      assert.doesNotMatch(
        await readFile(join(root, path), "utf8"),
        /fixture-secret/,
      );
    }
    assert.equal((await readdir(join(root, ".skilled-dsh/runs"))).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
