import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { decode } from "../../src/contracts/decode.js";
import type { EvalConfig, CaseConfig } from "../../src/contracts/schema.js";
import { Loader } from "../../src/config/loader.js";
import { detectAgent } from "../../src/agent/factory.js";
import {
  newEvaluator,
  EvaluationError,
  buildPlan,
} from "../../src/evaluator/index.js";

// A genuine local process engine: computes hashes over input and fixture bytes,
// writes workspace artifacts, and records process events for concurrency checks.
const worker = String.raw`
const fs=require('node:fs'),crypto=require('node:crypto');
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const prompt=input.messages.filter(m=>m.role==='user').at(-1)?.content||'';
const emit=(event)=>{if(process.env.EVENTS)fs.appendFileSync(process.env.EVENTS,JSON.stringify({event,id:input.case_id,pid:process.pid})+'\n')};
(async()=>{
 emit('start');
 fs.mkdirSync('results',{recursive:true});
 fs.writeFileSync('results/started.txt',prompt);
 if(process.env.ATTEMPTS){let n=0;try{n=Number(fs.readFileSync(process.env.ATTEMPTS,'utf8'))}catch{} fs.writeFileSync(process.env.ATTEMPTS,String(n+1));if(n===0){console.error('first actual process attempt fails');process.exit(19)}}
 if(process.env.DELAY)await new Promise(r=>setTimeout(r,Number(process.env.DELAY)));
 let fixture='';try{fixture=fs.readFileSync('input.txt','utf8')}catch{}
 const digest=crypto.createHash('sha256').update(prompt+fixture).digest('hex');
 const n=Number(input.session_id||0)+1;
 fs.writeFileSync('results/digest.txt',digest);
 const content=process.env.JSON_RESULT?JSON.stringify({digest,n}):digest;
 emit('end');
 console.log(JSON.stringify({exit_code:0,session_id:process.env.NO_SESSION?'':String(n),final_message:content,input_tokens:Buffer.byteLength(prompt),output_tokens:content.length,transcript:[{role:'assistant',content}],artifacts:{generated_files:['results/digest.txt']}}));
})();`;
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
async function harness(
  t: test.TestContext,
  env: Record<string, string> = {},
  overrides: Record<string, unknown> = {},
) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "skilled-evaluator-real-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "evals"), { recursive: true });
  await fs.writeFile(
    path.join(root, "SKILL.md"),
    "---\nname: skilled-hash\ndescription: Hash fixture contents\n---\nHash files.\n",
  );
  const evalCfg = decode<EvalConfig>("EvalConfig", {
    environment: { type: "none" },
    skills: [],
    engine: {
      name: "actual-hash",
      custom: {
        transport: "local",
        response_format: "session_result",
        conversation_mode: "stateful",
        env,
        local: {
          command: process.execPath,
          args: ["engine.cjs", "${input_file}"],
        },
      },
    },
    ...overrides,
  });
  await fs.writeFile(
    path.join(root, "evals/eval.yaml"),
    JSON.stringify(evalCfg),
  );
  const loader = await Loader.create(path.join(root, "evals/eval.yaml"));
  const outputDir = path.join(root, "output");
  const evaluator = (opts: Record<string, unknown> = {}) =>
    newEvaluator({
      skillName: "skilled-hash",
      skillDir: root,
      outputDir,
      deleteWorkspace: true,
      loader,
      evalCfg,
      agent: detectAgent(evalCfg.engine.name, {
        name: evalCfg.engine.name,
        custom: evalCfg.engine.custom,
      }),
      ...opts,
    });
  const makeCase = (id: string, extra: Record<string, unknown> = {}) =>
    decode<CaseConfig>("CaseConfig", {
      id,
      title: id,
      input: { prompt: id },
      context: {
        files: { "engine.cjs": worker, "input.txt": "fixture bytes" },
      },
      constraints: { timeout_seconds: 20, max_turns: 5 },
      collect_artifacts: ["results/**"],
      ...extra,
    });
  return { root, outputDir, evalCfg, evaluator, makeCase };
}
for (const concurrency of [1, 2, 4])
  test(
    `real process concurrency ${concurrency}, ordered results and balanced observers`,
    { timeout: 30_000 },
    async (t) => {
      const h = await harness(t);
      const events = path.join(h.root, "events.jsonl");
      h.evalCfg.engine.custom!.env = { EVENTS: events, DELAY: "180" };
      const starts: string[] = [],
        ends: string[] = [];
      const e = h.evaluator({
        concurrency,
        withBaseline: true,
        taskObserver: {
          onTaskStart(_ctx: unknown, task: { id: string }) {
            starts.push(task.id);
          },
          onTaskComplete(_ctx: unknown, task: { id: string }) {
            ends.push(task.id);
          },
        },
      });
      const cases = ["alpha", "beta", "gamma"].map((v) => h.makeCase(v));
      const results = await e.evaluateAll(cases);
      assert.deepEqual(
        results.map((r) => [r.caseID, r.configuration, r.status]),
        cases.flatMap((c) => [
          ["" + c.id, "with_skill", "PASS"],
          ["" + c.id, "without_skill", "PASS"],
        ]),
      );
      assert.equal(starts.length, 6);
      assert.deepEqual([...starts].sort(), [...ends].sort());
      const stream = (await fs.readFile(events, "utf8"))
        .trim()
        .split("\n")
        .map((s) => JSON.parse(s));
      let active = 0,
        peak = 0;
      for (const row of stream) {
        active += row.event === "start" ? 1 : -1;
        assert.ok(active >= 0);
        peak = Math.max(peak, active);
      }
      assert.equal(active, 0);
      assert.equal(peak, concurrency);
      for (const r of results) {
        assert.equal(r.final_message, hash(r.caseID + "fixture bytes"));
        assert.equal(
          await fs.readFile(
            path.join(
              h.outputDir,
              r.caseID,
              r.configuration,
              "outputs/workspace/results/digest.txt",
            ),
            "utf8",
          ),
          r.final_message,
        );
      }
    },
  );
test(
  "real execution errors retry; judgment failures do not retry",
  { timeout: 20_000 },
  async (t) => {
    const h = await harness(
      t,
      {},
      {
        cases: {
          retry_policy: { max_retries: 1, retry_on: ["error", "timeout"] },
        },
      },
    );
    const attempts = path.join(h.root, "attempts");
    h.evalCfg.engine.custom!.env = { ATTEMPTS: attempts };
    const [r] = await h.evaluator().evaluateAll([h.makeCase("retry")]);
    assert.equal(r!.status, "PASS", r!.error?.message);
    assert.equal(await fs.readFile(attempts, "utf8"), "2");
    const [failed] = await h.evaluator().evaluateAll([
      h.makeCase("judgment-failure", {
        expect: { must_contain: ["impossible-text"] },
      }),
    ]);
    assert.equal(failed!.status, "FAIL");
    assert.equal(await fs.readFile(attempts, "utf8"), "3");
  },
);
test(
  "case deadline kills a real process and collects existing files afterwards",
  { timeout: 15_000 },
  async (t) => {
    const h = await harness(t, { DELAY: "10000" });
    const [r] = await h
      .evaluator()
      .evaluateAll([
        h.makeCase("timeout", { constraints: { timeout_seconds: 1 } }),
      ]);
    assert.equal(r!.status, "ERROR");
    assert.match(
      r!.error!.message,
      /case timeout 1s via case.constraints.timeout_seconds/,
    );
    assert.equal(
      await fs.readFile(
        path.join(
          h.outputDir,
          "timeout/with_skill/outputs/workspace/results/started.txt",
        ),
        "utf8",
      ),
      "timeout",
    );
  },
);
test(
  "parent cancellation stops scheduling and retains completed or interrupted results",
  { timeout: 15_000 },
  async (t) => {
    const h = await harness(t, { DELAY: "10000" });
    const controller = new AbortController();
    const started: string[] = [];
    const timer = setTimeout(
      () => controller.abort(new DOMException("test cancelled", "AbortError")),
      800,
    );
    t.after(() => clearTimeout(timer));
    await assert.rejects(
      h
        .evaluator({
          concurrency: 2,
          taskObserver: {
            onTaskStart(_c: unknown, task: { id: string }) {
              started.push(task.id);
            },
            onTaskComplete() {},
          },
        })
        .evaluateAll(
          Array.from({ length: 8 }, (_, i) => h.makeCase("cancel-" + i)),
          controller.signal,
        ),
      (e) => {
        assert.ok(e instanceof EvaluationError);
        assert.equal(e.results.length, 2);
        assert.ok(e.results.every((r) => r.status === "ERROR"));
        return true;
      },
    );
    assert.equal(started.length, 2);
  },
);
test(
  "stateful real process captures JSON paths, resumes, accounts tokens, and archives overwritten files",
  { timeout: 20_000 },
  async (t) => {
    const h = await harness(t, { JSON_RESULT: "1" });
    const c = h.makeCase("turns", {
      input: {
        turns: [
          {
            role: "user",
            content: "first",
            capture: [{ variable: "digest", jsonpath: "$.digest" }],
          },
          { role: "user", content: "use {{digest}}" },
        ],
      },
    });
    const [r] = await h.evaluator().evaluateAll([c]);
    assert.equal(r!.status, "PASS", r!.error?.message);
    const first = hash("firstfixture bytes"),
      secondPrompt = "use " + first,
      second = hash(secondPrompt + "fixture bytes");
    assert.equal(r!.turnResults![0]!.capturedVars!.digest, first);
    assert.equal(r!.turnResults![1]!.content, secondPrompt);
    assert.equal(r!.session_id, "2");
    assert.equal(r!.input_tokens, 5 + Buffer.byteLength(secondPrompt));
    assert.equal(r!.turns, 2);
    const files = r!.artifacts?.generated_files ?? [];
    assert.ok(files.length >= 2, JSON.stringify(r));
    const values = await Promise.all(files.map((p) => fs.readFile(p, "utf8")));
    assert.ok(values.includes(first));
    assert.ok(values.includes(second));
  },
);
test(
  "postcondition skip_remaining stops actual processes and records skipped turns",
  { timeout: 15_000 },
  async (t) => {
    const h = await harness(t);
    const events = path.join(h.root, "events");
    h.evalCfg.engine.custom!.env = { EVENTS: events };
    const [r] = await h.evaluator().evaluateAll([
      h.makeCase("postcondition", {
        input: {
          turns: [
            {
              role: "user",
              content: "first",
              post_condition: {
                must_contain_all: ["never-in-digest"],
                on_fail: "skip_remaining",
              },
            },
            { role: "user", content: "second" },
          ],
        },
      }),
    ]);
    assert.equal(r!.status, "PASS");
    assert.deepEqual(
      r!.turnResults!.map((x) => x.status),
      ["failed", "skipped"],
    );
    assert.equal(
      (await fs.readFile(events, "utf8")).trim().split("\n").length,
      2,
    );
  },
);
test(
  "missing stateful session id is an explicit real-engine error",
  { timeout: 15_000 },
  async (t) => {
    const h = await harness(t, { NO_SESSION: "1" });
    const [r] = await h.evaluator().evaluateAll([
      h.makeCase("no-session", {
        input: { turns: [{ content: "first" }, { content: "second" }] },
      }),
    ]);
    assert.equal(r!.status, "ERROR");
    assert.match(r!.error!.message, /session/i);
  },
);
test(
  "parallel judge declarations execute against isolated real workspace snapshots",
  { timeout: 20_000 },
  async (t) => {
    const h = await harness(t);
    const mutate = path.join(h.root, "mutate.sh"),
      verify = path.join(h.root, "verify.sh");
    await fs.writeFile(
      mutate,
      '#!/bin/sh\nset -eu\ntest "$(cat input.txt)" = "fixture bytes"\nprintf changed > input.txt\nprintf "mutation stays in this fork"\n',
    );
    await fs.writeFile(
      verify,
      '#!/bin/sh\nset -eu\ntest "$(cat input.txt)" = "fixture bytes"\ntest -s results/digest.txt\nprintf "original fixture remains intact"\n',
    );
    const [r] = await h.evaluator().evaluateAll([
      h.makeCase("isolated", {
        judges: [
          { id: "mutate", type: "script", script_path: mutate },
          { id: "verify", type: "script", script_path: verify },
        ],
      }),
    ]);
    assert.equal(r!.status, "PASS", r!.error?.message);
    assert.deepEqual(
      r!.judgeResults!.map((j) => [j.id, j.status]),
      [
        ["mutate", "PASS"],
        ["verify", "PASS"],
      ],
    );
  },
);
test("plan expansion keeps iteration and global ordering stable", async (t) => {
  const h = await harness(t);
  const p = buildPlan([h.makeCase("a"), h.makeCase("b")], 3, 2, [
    "with_skill",
    "without_skill",
  ]);
  assert.equal(p.taskTotal, 8);
  assert.deepEqual(
    p.iterations.map((x) => x.number),
    [3, 4],
  );
  assert.deepEqual(
    p.iterations.flatMap((i) => i.tasks.map((t) => t.globalIndex)),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.equal(p.iterations[1]!.tasks[0]!.globalTotal, 8);
});
test(
  "multi-judge member deadline preserves later real script results",
  { timeout: 20_000 },
  async (t) => {
    const h = await harness(t);
    const slow = path.join(h.root, "slow.sh"),
      fast = path.join(h.root, "fast.sh");
    await fs.writeFile(slow, "#!/bin/sh\nsleep 10\n");
    await fs.writeFile(fast, "#!/bin/sh\ntest -s results/digest.txt\n");
    const [r] = await h.evaluator().evaluateAll([
      h.makeCase("judge-timeout", {
        judges: [
          { id: "slow", type: "script", script_path: slow, timeout_seconds: 1 },
          { id: "fast", type: "script", script_path: fast, timeout_seconds: 5 },
        ],
      }),
    ]);
    assert.equal(r!.status, "ERROR");
    assert.deepEqual(
      r!.judgeResults!.map((x) => x.status),
      ["ERROR", "PASS"],
    );
    assert.match(r!.error!.message, /timeout|timed out|deadline/);
  },
);
test(
  "expectation gate failure skips all real script judges",
  { timeout: 15_000 },
  async (t) => {
    const h = await harness(t);
    const script = path.join(h.root, "marker.sh"),
      marker = path.join(h.root, "SHOULD_NOT_EXIST");
    await fs.writeFile(script, `#!/bin/sh\nprintf invoked > '${marker}'\n`);
    const [r] = await h.evaluator().evaluateAll([
      h.makeCase("gate", {
        expect: { must_contain: ["cannot-match-hash"] },
        judges: [
          { id: "one", type: "script", script_path: script },
          { id: "two", type: "script", script_path: script },
        ],
      }),
    ]);
    assert.equal(r!.status, "FAIL");
    assert.deepEqual(
      r!.judgeResults!.map((x) => x.status),
      ["SKIP", "SKIP"],
    );
    await assert.rejects(fs.stat(marker));
  },
);
test(
  "case deadline in judging preserves deadline classification and pending skips",
  { timeout: 15_000 },
  async (t) => {
    const h = await harness(t);
    const script = path.join(h.root, "slow.sh");
    await fs.writeFile(script, "#!/bin/sh\nsleep 10\n");
    const [r] = await h.evaluator().evaluateAll([
      h.makeCase("judge-case-timeout", {
        constraints: { timeout_seconds: 1 },
        judges: [
          { id: "one", type: "script", script_path: script },
          { id: "two", type: "script", script_path: script },
        ],
      }),
    ]);
    assert.equal(r!.status, "ERROR");
    assert.deepEqual(
      r!.judgeResults!.map((x) => x.status),
      ["ERROR", "SKIP"],
    );
    assert.match(
      r!.error!.message,
      /case timeout 1s via case.constraints.timeout_seconds/,
    );
  },
);
test(
  "unresolved capture templates and failed captures stop subsequent real turns",
  { timeout: 15_000 },
  async (t) => {
    const h = await harness(t);
    const [missing, badCapture] = await h.evaluator().evaluateAll([
      h.makeCase("missing", {
        input: {
          turns: [{ content: "first" }, { content: "{{undefined}}" }],
        },
      }),
      h.makeCase("bad-capture", {
        input: {
          turns: [
            {
              content: "first",
              capture: [{ variable: "bad", pattern: "(will-not-match)" }],
            },
            { content: "second" },
          ],
        },
      }),
    ]);
    assert.equal(missing!.status, "ERROR");
    assert.match(missing!.error!.message, /undefined/);
    assert.equal(missing!.turnResults![0]!.status, "completed");
    assert.equal(badCapture!.status, "ERROR");
    assert.match(badCapture!.error!.message, /capture/);
  },
);
test(
  "fixture traversal and real setup failure stop before engine execution",
  { timeout: 15_000 },
  async (t) => {
    const h = await harness(t);
    const events = path.join(h.root, "events");
    h.evalCfg.engine.custom!.env = { EVENTS: events };
    const [badFixture] = await h.evaluator().evaluateAll([
      h.makeCase("bad-fixture", {
        context: { files: { "../escape": "bad" } },
      }),
    ]);
    assert.equal(badFixture!.status, "ERROR");
    assert.match(badFixture!.error!.message, /escapes workspace/);
    await assert.rejects(fs.stat(events));
    h.evalCfg.environment.setup_steps = [
      { run: "printf setup-error >&2; exit 21" },
    ];
    const [badSetup] = await h
      .evaluator()
      .evaluateAll([h.makeCase("bad-setup")]);
    assert.equal(badSetup!.status, "ERROR");
    assert.match(badSetup!.error!.message, /setup/);
    await assert.rejects(fs.stat(events));
  },
);
test(
  "full evaluator agent judge reads actual workspace evidence and archives correction attempts",
  { timeout: 20_000 },
  async (t) => {
    const { resolveRunnerConfig } =
      await import("../../src/credentials/index.js");
    const h = await harness(t);
    const dualWorker = String.raw`
const fs=require('node:fs'),crypto=require('node:crypto');const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(fs.existsSync('.skilled/judge/context/final_message.txt')){
 const value=fs.readFileSync('.skilled/judge/context/final_message.txt','utf8');const disk=fs.readFileSync('results/digest.txt','utf8');let n=0;try{n=Number(fs.readFileSync('judge-attempts','utf8'))}catch{};fs.writeFileSync('judge-attempts',String(++n));
 const passed=value===disk && disk===crypto.createHash('sha256').update('gradefixture bytes').digest('hex');
 const criterion={criterion_id:'criterion-1',passed,evidence:['actual file hash '+disk],failures:passed?[]:['hash mismatch']};if(n===1)delete criterion.failures;
 const response=JSON.stringify({results:[criterion]});console.log(JSON.stringify({exit_code:0,session_id:'judge-'+n,final_message:response,transcript:[{role:'assistant',content:response}]}));
}else{
 const prompt=input.messages.at(-1).content;const digest=crypto.createHash('sha256').update(prompt+fs.readFileSync('input.txt','utf8')).digest('hex');fs.mkdirSync('results',{recursive:true});fs.writeFileSync('results/digest.txt',digest);fs.writeFileSync('actual-output.txt',digest);
 console.log(JSON.stringify({exit_code:0,session_id:'run-1',final_message:digest,transcript:[{role:'assistant',content:digest}],artifacts:{generated_files:['results/digest.txt']}}));
}`;
    const c = h.makeCase("grade", {
      context: {
        git: { init: true },
        files: { "engine.cjs": dualWorker, "input.txt": "fixture bytes" },
      },
      judge: {
        type: "agent_judge",
        criteria: [
          "The actual digest file equals the SHA256 of the configured prompt plus fixture bytes",
        ],
      },
    });
    const workspace = path.join(h.root, "workspace");
    await fs.mkdir(workspace);
    const [r] = await h
      .evaluator({
        workspaceDir: await fs.realpath(workspace),
        runnerConfig: resolveRunnerConfig(h.evalCfg.engine),
      })
      .evaluateAll([c]);
    assert.equal(r!.status, "PASS", r!.error?.message);
    assert.match(
      r!.grading!.assertion_results[0]!.evidence,
      /actual file hash/,
    );
    assert.match(r!.artifacts!.workspace_diff!, /actual-output.txt/);
    assert.ok(
      !r!.artifacts!.workspace_diff!.includes(
        "diff --git a/results/digest.txt b/results/digest.txt",
      ),
      JSON.stringify(r!.artifacts),
    );
    assert.equal(r!.judgeSession!.session_id, "judge-2");
    for (const n of [1, 2])
      assert.ok(
        (
          await fs.readFile(
            path.join(
              h.outputDir,
              "grade/with_skill/outputs/judge/run",
              `raw-response-attempt-${n}.txt`,
            ),
            "utf8",
          )
        ).includes("criterion-1"),
      );
  },
);
