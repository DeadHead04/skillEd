import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const execute = promisify(execFile);
test("artifact validators distinguish task failures, protected-field drift and invalid validators", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skilled-judge-"));
  const harness = await readFile(
    new URL("./judge-harness.py", import.meta.url),
    "utf8",
  );
  const assertions = [
    { id: "correct", dimension: "correctness" },
    { id: "protected", dimension: "scope" },
  ];
  async function grade(output: unknown, checks: unknown[]) {
    if (output !== undefined)
      await writeFile(join(dir, "output.json"), JSON.stringify(output));
    else await rm(join(dir, "output.json"), { force: true });
    const spec = {
      assertions,
      checks,
      truth: {
        original: Buffer.from(
          JSON.stringify({ target: "old", protected: 42 }),
        ).toString("base64"),
      },
    };
    await writeFile(
      join(dir, "judge.py"),
      `${harness}\nsys.exit(run_checks(json.loads(${JSON.stringify(JSON.stringify(spec))})))\n`,
    );
    const result = await execute("python3", ["judge.py"], { cwd: dir }).catch(
      (error) => error,
    );
    return JSON.parse(result.stdout);
  }
  const checks = [
    {
      kind: "equals",
      file: "output.json",
      format: "json",
      selector: "/target",
      value: "new",
      dimension: "correctness",
    },
    {
      kind: "unchanged",
      file: "output.json",
      format: "json",
      expectedMaterialId: "original",
      allowedPaths: ["/target"],
      dimension: "scope",
    },
  ];
  try {
    assert.deepEqual(
      (await grade({ target: "new", protected: 42 }, checks)).assertions.map(
        (a: any) => a.passed,
      ),
      [true, true],
    );
    assert.deepEqual(
      (await grade({ target: "new", protected: 43 }, checks)).assertions.map(
        (a: any) => a.passed,
      ),
      [true, false],
    );
    const missing = await grade(undefined, checks);
    assert.equal(missing.error, null);
    assert.equal(missing.assertions[0].passed, false);
    const bad = await grade({}, [{ ...checks[0], kind: "unsupported" }]);
    assert.equal(bad.error.code, "VALIDATOR_ERROR");
    for (const format of ["text", "csv"]) {
      await writeFile(
        join(dir, "document"),
        format === "text" ? "expected output" : "name,value\nitem,42\n",
      );
      const spec = {
        assertions: [assertions[0]],
        checks: [
          {
            kind: "equals",
            file: "document",
            format,
            selector: format === "csv" ? "/0/value" : "",
            value: format === "csv" ? "42" : "expected output",
            dimension: "correctness",
          },
        ],
      };
      await writeFile(
        join(dir, "judge.py"),
        `${harness}\nsys.exit(run_checks(json.loads(${JSON.stringify(JSON.stringify(spec))})))\n`,
      );
      assert.equal(
        JSON.parse(
          (await execute("python3", ["judge.py"], { cwd: dir })).stdout,
        ).assertions[0].passed,
        true,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
