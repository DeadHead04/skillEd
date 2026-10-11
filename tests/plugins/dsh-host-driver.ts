import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.argv[2],
  host = process.argv[3],
  cli = process.argv[4];
const requireHost = createRequire(join(host, "package.json"));
const load = async (name: string) =>
  import(pathToFileURL(requireHost.resolve(name)).href);
const { Context } = await load("@deepseek-ai/cordis");
const packages = [
  "dsh-system-prompt",
  "dsh-tools",
  "dsh-skill",
  "dsh-session",
  "dsh-jobs-local",
  "dsh-subprocess-local",
];
const implementations = await Promise.all(
  packages.map(async (name) => (await load(`@deepseek-ai/${name}`)).default),
);
const plugin = await import(pathToFileURL(join(root, "plugin/index.js")).href);
const ctx = new Context();
for (const implementation of implementations) ctx.plugin(implementation, {});
const bin = join(root, "skilled");
writeFileSync(
  bin,
  `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${cli.replaceAll("'", "'\\''")}' "$@"\n`,
  { mode: 0o755 },
);
ctx.plugin(plugin, {
  skilledBin: bin,
  observer: { enabled: true, dataDir: join(root, "observations") },
});
await new Promise((resolve) => setImmediate(resolve));
try {
  assert.equal(ctx.tools.schemas().length, 12);
  assert.equal(
    (await ctx.skills.get("skilled-improve")).name,
    "skilled-improve",
  );
  const call = async (name: string, args: unknown) => {
    const result = await ctx.tools.execute({
      callId: `host-${name}`,
      name,
      arguments: args,
      signal: new AbortController().signal,
    });
    assert.equal(result.isError, false, JSON.stringify(result));
    return result.value;
  };
  const session = ctx.sessions.create("real-session", { meta: { cwd: root } });
  session.append("turn/start", { turn: 1 });
  session.append(
    "user/message",
    {
      turn: 1,
      source: { kind: "user" },
      content: [{ type: "text", text: "Use /demo-skill with TOKEN=private" }],
    },
    { surfaceOp: "append" },
  );
  session.append(
    "user/message",
    {
      turn: 1,
      source: { kind: "skill-invocation", name: "demo-skill" },
      content: [{ type: "text", text: "loaded" }],
    },
    { surfaceOp: "append" },
  );
  session.append("turn/end", { turn: 1, reason: { kind: "completed" } });
  const records = (await call("list_skill_observations", {})).observations;
  assert.equal(records.length, 1);
  const id = records[0].id;
  const observation = await call("get_skill_observation", {
    observation_id: id,
  });
  assert.doesNotMatch(JSON.stringify(observation), /private/);
  await call("record_observation_feedback", {
    observation_id: id,
    sentiment: "negative",
    comment: "Make output more exact",
  });
  assert.equal(
    (await call("collect_skill_feedback", { skill_name: "demo-skill" }))
      .feedback_observations,
    1,
  );
  await call("review_skill_observation", {
    observation_id: id,
    status: "approved",
  });
  const candidate = await call("preview_observation_case", {
    observation_id: id,
  });
  assert.match(candidate.yaml, /Observed demo-skill/);
  writeFileSync(
    join(root, "SKILL.md"),
    "---\nname: demo-skill\ndescription: test\n---\nReal integration skill\n",
  );
  mkdirSync(join(root, "evals"), { recursive: true });
  writeFileSync(
    join(root, "evals/eval.yaml"),
    "schema_version: v1alpha1\nenvironment:\n  type: none\nengine:\n  name: codex\ncases:\n  files: []\n",
  );
  const written = await call("write_observation_case", {
    observation_id: id,
    skill_root: ".",
  });
  assert.equal(written.validation, "passed");
  assert.equal((await call("skilled_validate", {})).exit_code, 0);
  ctx.jobs.attachController("integration");
  const job = await call("skilled_run", { dry_run: true });
  const settled = await ctx.jobs.wait(job.job_id, 30_000);
  assert.equal(settled.status, "completed", JSON.stringify(settled));
  assert.match(ctx.jobs.read(job.job_id).text, /Would run/);
  writeFileSync(
    join(root, "before.json"),
    JSON.stringify({
      case_results: [
        { case_id: "a", status: "FAIL", configuration: "with_skill" },
      ],
    }),
  );
  writeFileSync(
    join(root, "after.json"),
    JSON.stringify({
      case_results: [
        { case_id: "a", status: "PASS", configuration: "with_skill" },
      ],
    }),
  );
  assert.equal(
    (await call("skilled_summary", { result_path: "after.json" })).passed,
    1,
  );
  assert.equal(
    (
      await call("skilled_compare", {
        before_result_path: "before.json",
        after_result_path: "after.json",
      })
    ).cases[0].changed,
    true,
  );
  await call("link_observation_report", {
    observation_id: id,
    phase: "baseline",
    result_path: "before.json",
  });
  console.log(
    JSON.stringify({
      passed: true,
      tools: 12,
      services: packages,
      realSession: true,
      realCLIValidation: true,
      realBackgroundJob: true,
      authenticatedModel: false,
    }),
  );
} finally {
  await ctx.fiber.dispose();
}
