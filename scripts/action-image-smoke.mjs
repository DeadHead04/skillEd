import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = await mkdtemp(join(tmpdir(), "skilled-action-smoke-"));
try {
  for (const failure of [false, true]) {
    const workspace = join(root, failure ? "fail" : "pass");
    await mkdir(join(workspace, "evals/cases"), { recursive: true });
    await mkdir(join(workspace, "home"));
    await writeFile(
      join(workspace, "SKILL.md"),
      "---\nname: action-smoke\ndescription: Real installed Action acceptance\n---\nHash the prompt.\n",
    );
    const worker = `const fs=require('node:fs'),c=require('node:crypto');const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const text=input.messages.filter(x=>x.role==='user').at(-1).content;console.log(JSON.stringify({exit_code:0,final_message:c.createHash('sha256').update(text).digest('hex')}));`;
    const config = {
      schema_version: "v1alpha1",
      environment: { type: "none" },
      engine: {
        name: "action-hash",
        custom: {
          transport: "local",
          response_format: "session_result",
          local: { command: "node", args: ["engine.cjs", "${input_file}"] },
        },
      },
      cases: {
        files: ["evals/cases/hash.yaml"],
        retry_policy: { max_retries: 0 },
      },
    };
    const expected = createHash("sha256")
      .update("action-real-input")
      .digest("hex");
    const testcase = {
      id: "hash",
      input: { prompt: "action-real-input" },
      context: { files: { "engine.cjs": worker } },
      judge: {
        type: "rule_based",
        success: [
          {
            output_contains: {
              all: [failure ? "intentional-negative" : expected],
            },
          },
        ],
      },
    };
    await writeFile(join(workspace, "evals/eval.yaml"), JSON.stringify(config));
    await writeFile(
      join(workspace, "evals/cases/hash.yaml"),
      JSON.stringify(testcase),
    );
    const output = join(workspace, "github-output");
    const child = spawnSync(
      "/opt/skilled/action/entry.sh",
      ["--skill-target", workspace, "--skilled-command", "skilled run"],
      {
        cwd: workspace,
        env: {
          PATH: process.env.PATH,
          HOME: join(workspace, "home"),
          GITHUB_WORKSPACE: workspace,
          GITHUB_OUTPUT: output,
          OTEL_SDK_DISABLED: "true",
        },
        encoding: "utf8",
        timeout: 120000,
      },
    );
    assert.equal(child.status, failure ? 1 : 0, child.stdout + child.stderr);
    const values = await readFile(output, "utf8");
    assert.match(values, new RegExp(`exit-code=${failure ? 1 : 0}`));
    assert.match(values, /report-dir=skilled-workspace/);
    const reports = join(workspace, "skilled-workspace/iteration-1");
    assert.equal(
      JSON.parse(await readFile(join(reports, "report.json"), "utf8"))
        .case_results[0].status,
      failure ? "FAIL" : "PASS",
    );
    assert.match(
      await readFile(join(reports, "report.xml"), "utf8"),
      /testsuite/,
    );
    assert.match(await readFile(join(reports, "report.html"), "utf8"), /html/);
  }
  console.log(
    JSON.stringify({
      probe: "actual-container-action",
      positive: true,
      negative: true,
      reports: ["json", "junit", "html"],
      githubOutputs: true,
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
