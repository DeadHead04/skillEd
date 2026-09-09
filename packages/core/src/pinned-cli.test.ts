import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeGrading } from "./grading";
const execute = promisify(execFile);
const binary = process.env.SKILLED_CONTRACT_CLI;
test(
  "rebuilt Skill-Up script judge evidence normalizes PASS, PARTIAL, FAIL and ERROR",
  { skip: !binary },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "skilled-cli-contract-"));
    const definitions = [
      {
        id: "target",
        text: "target",
        dimension: "correctness" as const,
        required: true,
      },
      {
        id: "scope",
        text: "scope",
        dimension: "scope" as const,
        required: true,
      },
    ];
    try {
      for (const [values, expected] of [
        [[true, true], "PASS"],
        [[true, false], "PARTIAL"],
        [[false, false], "FAIL"],
      ] as const) {
        const script = join(dir, "validator.py");
        const envelope = {
          schemaVersion: "skilled-grading-v1",
          assertions: definitions.map((d, n) => ({
            id: d.id,
            passed: values[n],
            evidence: "Concrete fixture output",
          })),
          error: null,
        };
        await writeFile(
          script,
          `#!/usr/bin/env python3
print(${JSON.stringify(JSON.stringify(envelope))})\nraise SystemExit(${values.every(Boolean) ? 0 : 1})\n`,
        );
        const input = join(dir, "input.json"),
          output = join(dir, "grading.json");
        await writeFile(
          input,
          JSON.stringify({
            case_id: "CASE",
            final_message: "result",
            exit_code: 0,
            workspace_path: dir,
            judge: { type: "script", script_path: script, timeout_seconds: 2 },
          }),
        );
        await execute(binary!, ["debug", "judge", input, "--output", output], {
          cwd: dir,
          // Only trusted, generated validator fixtures run here, without model
          // calls or credential mounts. Isolation has a separate fail-closed gate.
          env: {
            PATH: process.env.PATH,
            HOME: dir,
            SKILLED_SCRIPT_SANDBOX: "",
          },
          timeout: 10_000,
        });
        const grading = JSON.parse(await readFile(output, "utf8"));
        assert.equal(
          normalizeGrading(
            { status: grading.status, grading },
            definitions,
            "script",
          ).result,
          expected,
          JSON.stringify(grading),
        );
      }
      for (const body of [
        'print("missing envelope")',
        'print("{broken")',
        'raise RuntimeError("validator crashed")',
        "import time; time.sleep(5)",
      ]) {
        const script = join(dir, "validator.py");
        await writeFile(script, "#!/usr/bin/env python3\n" + body);
        const input = join(dir, "input.json"),
          output = join(dir, "grading.json");
        await writeFile(
          input,
          JSON.stringify({
            case_id: "CASE",
            final_message: "",
            exit_code: 0,
            workspace_path: dir,
            judge: { type: "script", script_path: script, timeout_seconds: 1 },
          }),
        );
        await execute(binary!, ["debug", "judge", input, "--output", output], {
          cwd: dir,
          // Only trusted, generated validator fixtures run here, without model
          // calls or credential mounts. Isolation has a separate fail-closed gate.
          env: {
            PATH: process.env.PATH,
            HOME: dir,
            SKILLED_SCRIPT_SANDBOX: "",
          },
          timeout: 10_000,
        });
        const grading = JSON.parse(await readFile(output, "utf8"));
        assert.equal(
          normalizeGrading(
            { status: grading.status, grading },
            definitions,
            "script",
          ).result,
          "ERROR",
        );
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
