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
import os from "node:os";
import path from "node:path";
import { NoneRuntime } from "../../src/runtime/none.js";
import { CustomAgent, StatefulCustomAgent } from "../../src/agent/custom.js";
import { decode } from "../../src/contracts/decode.js";
import type {
  JudgeConfig,
  JudgeContextConfig,
  CustomEngineConfig,
  Expect,
} from "../../src/contracts/schema.js";
import {
  ScriptJudge,
  AgentJudge,
  RuleBasedJudge,
  checkExpect,
  toAssertionResults,
  newResult,
  newSkipResult,
  AllRequiredAggregator,
  materializeJudgeContext,
  mergeJudgeContextConfig,
  parseAgentJudgeResults,
  sessionResultFromError,
  buildJudgePrompt,
  tokenizeShebangSplitString,
  planScript,
  parseShebang,
} from "../../src/judge/index.js";
async function setup(t: test.TestContext) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skilled-judge-test-"));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const rt = new NoneRuntime({ type: "none", workspaceDir: dir });
  await rt.create();
  return { dir, rt };
}
test("real rule and expect filesystem grading including failure-first and argument structure", async (t) => {
  const { dir } = await setup(t);
  await writeFile(path.join(dir, "answer.txt"), "alpha result");
  await writeFile(path.join(dir, "golden.txt"), "alpha\n");
  const input = {
    finalMessage: "alpha",
    exitCode: 0,
    workspacePath: dir,
    transcript: [
      {
        role: "tool_call",
        tool_call: {
          name: "write",
          arguments: { nested: { b: 2, a: 1 }, extra: true },
        },
      },
    ],
    turnsExecuted: 1,
    turnsTotal: 1,
  };
  const cfg = decode<JudgeConfig>("JudgeConfig", {
    type: "rule_based",
    success: [
      { output_matches: { all: ["^alpha$"] } },
      { files_exist: ["answer.txt"] },
      { tool_called: { name: "write", args: { nested: { a: 1, b: 2 } } } },
    ],
  });
  assert.equal((await new RuleBasedJudge(cfg).evaluate(input)).status, "PASS");
  cfg.failure = decode<JudgeConfig>("JudgeConfig", {
    failure: [{ output_contains: { all: ["alpha"] } }],
  }).failure;
  const fail = await new RuleBasedJudge(cfg).evaluate(input);
  assert.equal(fail.status, "FAIL");
  assert.equal(fail.assertion_results.length, 1);
  const expect = decode<Expect>("Expect", {
    must_contain: ["alpha"],
    must_not_contain: ["beta"],
    exit_code: 0,
    files_exist: ["answer.txt"],
    files_not_exist: ["missing"],
    golden_file: "golden.txt",
    file_contains: [{ path: "answer.txt", content: "result" }],
  });
  const checked = await checkExpect(expect, input);
  assert.equal(checked.passed, true);
  assert.equal(toAssertionResults(checked).length, 7);
  const failed = await checkExpect(
    { ...expect, must_contain: ["one", "two"], files_exist: ["../outside"] },
    input,
  );
  assert.equal(failed.passed, false);
  assert(
    toAssertionResults(failed).some(
      (a) => a.evidence.includes("one") && a.evidence.includes("two"),
    ),
  );
});
test("real script judge evaluates workspace files, transcript and injected outcome", async (t) => {
  const { dir, rt } = await setup(t);
  const script = path.join(dir, "judge.sh"),
    transcript = path.join(dir, "transcript.json");
  await writeFile(path.join(dir, "answer.txt"), "alpha");
  await writeFile(transcript, '[{"role":"assistant","content":"alpha"}]');
  await writeFile(
    script,
    '#!/bin/sh\nset -eu\ntest "$(cat answer.txt)" = "$EVAL_FINAL_MESSAGE"\ntest "$EVAL_EXIT_CODE" = 0\ntest -s "$EVAL_TRANSCRIPT_PATH"\nprintf "checked actual workspace and transcript"\n',
    { mode: 0o755 },
  );
  const judge = new ScriptJudge(script, 5, rt);
  judge.transcriptPath = transcript;
  const pass = await judge.evaluate({
    workspacePath: dir,
    finalMessage: "alpha",
    exitCode: 0,
  });
  assert.equal(pass.status, "PASS");
  assert.match(pass.assertion_results[0].evidence, /actual workspace/);
  const fail = await judge.evaluate({
    workspacePath: dir,
    finalMessage: "different",
    exitCode: 0,
  });
  assert.equal(fail.status, "FAIL");
});
test("real script timeout preserves configured failure/error policy and cleanup", async (t) => {
  const { dir, rt } = await setup(t);
  const script = path.join(dir, "slow.sh");
  await writeFile(script, "#!/bin/sh\nsleep 10\n");
  const judge = new ScriptJudge(script, 0.05, rt);
  const fail = await judge.evaluate({ workspacePath: dir });
  assert.equal(fail.status, "FAIL");
  assert.match(fail.assertion_results[0].evidence, /timed out/);
  judge.timeoutIsError = true;
  await assert.rejects(judge.evaluate({ workspacePath: dir }), /timed out/);
});
test("real context materialization uploads files, caps inline bytes and archives attachments", async (t) => {
  const { dir, rt } = await setup(t);
  await writeFile(path.join(dir, "rubric.txt"), "rubric content");
  const cfg = decode<JudgeContextConfig>("JudgeContextConfig", {
    profile: "standard",
    final_message: "truncate",
    limits: {
      max_bytes: 5,
      transcript_max_turns: 1,
      workspace_diff_max_lines: 1,
    },
    attachments: [{ path: "rubric.txt", label: "Rubric A" }],
  });
  const artifactDir = path.join(dir, "report/judge/run");
  const mc = await materializeJudgeContext(
    rt,
    cfg,
    {
      finalMessage: "abcdefgh",
      workspacePath: dir,
      skillDir: dir,
      transcript: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ],
      workspaceDiff: "one\ntwo\n",
      generatedFiles: ["result.txt"],
    },
    artifactDir,
  );
  assert.equal(mc.materials[0].inlineContent, "abcde");
  assert.equal(mc.materials[0].truncated, true);
  assert.equal(
    await readFile(path.join(mc.runtimeDir, "final_message.txt"), "utf8"),
    "abcdefgh",
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(mc.dir, "transcript.json"), "utf8")),
    [{ role: "assistant", content: "b" }],
  );
  assert.equal(
    await readFile(path.join(mc.dir, "workspace.diff"), "utf8"),
    "one\n",
  );
  assert.equal(
    await readFile(path.join(mc.dir, "attachments/01-rubric-a.txt"), "utf8"),
    "rubric content",
  );
  assert.equal(
    (await stat(path.join(mc.dir, "manifest.json"))).mode & 0o777,
    0o600,
  );
  const manifest = JSON.parse(
    await readFile(path.join(mc.dir, "manifest.json"), "utf8"),
  );
  assert(!JSON.stringify(manifest).includes("inlineContent"));
});
const grader = String.raw`const fs=require('node:fs'),path=require('node:path');const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const value=fs.readFileSync('.skilled/judge/context/final_message.txt','utf8');let n=0;try{n=Number(fs.readFileSync('grader-count','utf8'))}catch{}fs.writeFileSync('grader-count',String(++n));const passed=value.includes('alpha');const criterion={criterion_id:'criterion-1',passed,evidence:['Read final_message.txt: '+value],failures:passed?[]:['alpha was missing from actual file']};if(process.env.CORRECT==='yes'&&n===1)delete criterion.failures;const response=JSON.stringify({results:[criterion]});console.log(JSON.stringify({exit_code:0,session_id:String(n),final_message:response,input_tokens:3,output_tokens:2,turns:1,transcript:[{role:'assistant',content:response}]}));if(process.env.EXIT==='yes')process.exit(9);`;
for (const stateful of [false, true])
  test(`real AgentJudge ${stateful ? "resumed" : "independent"} correction grades materialized file`, async (t) => {
    const { dir, rt } = await setup(t);
    await writeFile(path.join(dir, "grader.cjs"), grader);
    const custom = decode<CustomEngineConfig>("CustomEngineConfig", {
      transport: "local",
      env: { CORRECT: "yes" },
      local: {
        command: process.execPath,
        args: ["grader.cjs", "${input_file}"],
      },
    });
    const agent = stateful
      ? new StatefulCustomAgent({ name: "actual-grader", custom })
      : new CustomAgent({ name: "actual-grader", custom });
    const judge = new AgentJudge(agent, rt, "", ["Contains alpha"], 0.7);
    const result = await judge.evaluate({
      caseID: "grade",
      workspacePath: dir,
      finalMessage: "actual alpha content",
      artifactDir: path.join(dir, "artifacts/judge/run"),
      turnsExecuted: 1,
      turnsTotal: 1,
    });
    assert.equal(result.status, "PASS");
    assert.match(result.assertion_results[0].evidence, /actual alpha content/);
    assert.equal(result.judgeSession?.input_tokens, 6);
    assert.equal(result.judgeSession?.turns, 2);
    assert.equal(result.judgeSession?.session_id, "2");
    assert(!JSON.stringify(result).includes("judgeSession"));
    assert.equal(await readFile(path.join(dir, "grader-count"), "utf8"), "2");
    assert(
      (
        await readFile(
          path.join(dir, "artifacts/judge/run/raw-response-attempt-1.txt"),
          "utf8",
        )
      ).includes("criterion-1"),
    );
    assert(
      (
        await readFile(
          path.join(dir, "artifacts/judge/run/raw-response-attempt-2.txt"),
          "utf8",
        )
      ).includes("failures"),
    );
  });
test("real AgentJudge recovers completed grading on process nonzero and returns failure verdict", async (t) => {
  const { dir, rt } = await setup(t);
  await writeFile(path.join(dir, "grader.cjs"), grader);
  const custom = decode<CustomEngineConfig>("CustomEngineConfig", {
    transport: "local",
    env: { EXIT: "yes" },
    local: { command: process.execPath, args: ["grader.cjs", "${input_file}"] },
  });
  const judge = new AgentJudge(
    new CustomAgent({ name: "grader", custom }),
    rt,
    "",
    ["Contains alpha"],
  );
  const result = await judge.evaluate({
    workspacePath: dir,
    finalMessage: "beta",
    artifactDir: path.join(dir, "artifacts/run"),
  });
  assert.equal(result.status, "FAIL");
  assert.equal(result.judgeSession?.exit_code, 9);
  assert.match(
    result.assertion_results[0].evidence,
    /Failures: alpha was missing/,
  );
});
test("strict criterion validation rejects duplicate/case/extra fields and malformed evidence", () => {
  const good = {
    results: [
      {
        criterion_id: "criterion-1",
        passed: true,
        evidence: [" concrete "],
        failures: [],
      },
    ],
  };
  assert.deepEqual(
    parseAgentJudgeResults(["x"], JSON.stringify(good))[0].evidence,
    ["concrete"],
  );
  assert.equal(
    parseAgentJudgeResults(
      ["x"],
      "```json\n" + JSON.stringify(good) + "\n```",
    )[0].passed,
    true,
  );
  const invalid = [
    '{"results":[],"results":[]}',
    '{"Results":[]}',
    '{"results":[],"extra":true}',
    "null",
    "[]",
    '{"results":null}',
    '{"results":[]}',
    JSON.stringify({
      results: [
        {
          criterion_id: "criterion-1",
          passed: true,
          evidence: [],
          failures: [],
        },
      ],
    }),
    JSON.stringify({
      results: [
        {
          criterion_id: "criterion-1",
          passed: false,
          evidence: ["x"],
          failures: [],
        },
      ],
    }),
    JSON.stringify({
      results: [
        {
          criterion_id: "criterion-1",
          passed: true,
          evidence: ["x"],
          failures: ["bad"],
        },
      ],
    }),
    "before " + JSON.stringify(good),
    JSON.stringify(good) + " after",
  ];
  for (const value of invalid)
    assert.throws(() => parseAgentJudgeResults(["x"], value));
});
test("source config inheritance, aggregation, shebang tokenization and platform dispatch vectors", async (t) => {
  const global = decode<JudgeContextConfig>("JudgeContextConfig", {
      profile: "standard",
      attachments: [{ path: "rubric" }],
    }),
    local = decode<JudgeContextConfig>("JudgeContextConfig", {
      profile: "minimal",
    });
  assert.equal(mergeJudgeContextConfig(global, local)?.attachments?.length, 1);
  assert.deepEqual(
    mergeJudgeContextConfig(global, { ...local, attachments: [] })?.attachments,
    [],
  );
  const agg = new AllRequiredAggregator().aggregate(
    [
      {
        id: "a",
        type: "rule_based",
        status: "PASS",
        duration_ms: 1,
        result: newResult([]),
      },
      {
        id: "b",
        type: "script",
        status: "SKIP",
        duration_ms: 1,
        result: newSkipResult("skip"),
        skip_reason: "skip",
      },
    ],
    1,
    1,
  );
  assert.equal(agg.status, "ERROR");
  assert.equal(agg.result.summary.failed, 1);
  assert.deepEqual(
    tokenizeShebangSplitString("bash\\_-eu \"two words\" 'literal'\\c ignored"),
    ["bash", "-eu", "two words", "literal"],
  );
  assert.deepEqual(parseShebang("/usr/bin/env -u VAR -S bash -eu"), {
    interpreter: "bash",
    options: ["-eu"],
  });
  const { dir } = await setup(t);
  const script = path.join(dir, "script.ps1");
  await writeFile(script, "#!/usr/bin/env -S pwsh -NoLogo\n");
  const plan = await planScript(script, { goos: "windows", family: "cmd" });
  assert.match(plan.command("C:\\tmp\\judge.ps1"), /^pwsh .*NoLogo.*NoProfile/);
});

test("AgentJudge real timeout recovers completed verdict, explicit cancellation does not", async (t) => {
  const { dir, rt } = await setup(t);
  await writeFile(
    path.join(dir, "grader.cjs"),
    grader.replace(
      "if(process.env.EXIT==='yes')process.exit(9);",
      "process.stdout.write('',()=>fs.writeFileSync('grader-ready',String(n)));setTimeout(()=>{},10000);",
    ),
  );
  const config = decode<CustomEngineConfig>("CustomEngineConfig", {
    transport: "local",
    local: { command: process.execPath, args: ["grader.cjs", "${input_file}"] },
  });
  const judge = new AgentJudge(
    new CustomAgent({ name: "timed-grader", custom: config }),
    rt,
    "",
    ["Contains alpha"],
    0.7,
    null,
    2,
  );
  const input = {
    workspacePath: dir,
    finalMessage: "alpha",
    artifactDir: path.join(dir, "archive/run"),
  };
  const recovered = await judge.evaluate(input);
  assert.equal(recovered.status, "PASS");
  assert.equal(recovered.judgeSession?.session_id, "1");
  judge.timeoutSeconds = 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const cancelled = assert.rejects(
    judge.evaluate(input, controller.signal),
    (error: unknown) => {
      const session = sessionResultFromError(error);
      assert.equal(session?.session_id, "2");
      assert.match(session?.final_message ?? "", /criterion-1/);
      return true;
    },
  );
  try {
    const deadline = Date.now() + 5_000;
    while ((await readFile(path.join(dir, "grader-ready"), "utf8")) !== "2") {
      assert(Date.now() < deadline, "second grader did not flush its verdict");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    controller.abort();
    await cancelled;
  } finally {
    clearTimeout(timer);
    controller.abort();
    await cancelled;
  }
});
test("invalid real grader correction retains both response archives and session on error", async (t) => {
  const { dir, rt } = await setup(t);
  await writeFile(
    path.join(dir, "grader.cjs"),
    grader.replace("if(process.env.CORRECT==='yes'&&n===1)", "if(true)"),
  );
  const config = decode<CustomEngineConfig>("CustomEngineConfig", {
    transport: "local",
    local: { command: process.execPath, args: ["grader.cjs", "${input_file}"] },
  });
  const judge = new AgentJudge(
    new CustomAgent({ name: "invalid-grader", custom: config }),
    rt,
    "",
    ["Contains alpha"],
  );
  const artifactDir = path.join(dir, "archive/run");
  await assert.rejects(
    judge.evaluate({ workspacePath: dir, finalMessage: "alpha", artifactDir }),
    (error: unknown) => {
      const session = sessionResultFromError(error);
      assert.equal(session?.turns, 2);
      assert.match(
        (error as Error).message,
        /correction retry remained invalid/,
      );
      return true;
    },
  );
  assert(
    (
      await readFile(
        path.join(artifactDir, "raw-response-attempt-1.txt"),
        "utf8",
      )
    ).includes("criterion-1"),
  );
  assert(
    (
      await readFile(
        path.join(artifactDir, "raw-response-attempt-2.txt"),
        "utf8",
      )
    ).includes("criterion-1"),
  );
});
