import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
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
import { renameSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decode } from "../../src/contracts/decode.js";
import type { EvalConfig, CaseConfig } from "../../src/contracts/schema.js";
import { Loader } from "../../src/config/loader.js";
import { detectAgent } from "../../src/agent/factory.js";
import { EvaluationError, type EvalResult } from "../../src/evaluator/index.js";
import {
  newRunner,
  nextIterationNumber,
  canonicalizePotentialPath,
  validateExternalWorkspaceOutput,
  pathsOverlap,
  responseContent,
  buildReportInput,
  groupResultsByCase,
  indexCaseResults,
  formatIterationStabilitySummary,
  buildIterationStabilitySummaries,
} from "../../src/runner/index.js";
import { setOutput } from "../../src/ui/index.js";
import { setOutput as setLogOutput } from "../../src/logging/index.js";
const fixture = JSON.parse(
  await readFile(
    fileURLToPath(
      new URL("../../../tests/integration/phase3/config.json", import.meta.url),
    ),
    "utf8",
  ),
);
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "skilled-runner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skill = path.join(root, "directory-name"),
    output = path.join(root, "output");
  await mkdir(path.join(skill, "evals"), { recursive: true });
  await writeFile(
    path.join(skill, "SKILL.md"),
    "---\nname: skilled-improve\n---\nHash input.\n",
  );
  const cfg = decode<EvalConfig>("EvalConfig", structuredClone(fixture.eval));
  cfg.cases.parallelism = 2;
  cfg.benchmark.enabled = false;
  const loader = await Loader.create(path.join(skill, "evals/eval.yaml"));
  const cases: CaseConfig[] = fixture.cases.map((v: unknown) =>
    decode<CaseConfig>("CaseConfig", v),
  );
  const agent = detectAgent(cfg.engine.name, {
    name: cfg.engine.name,
    custom: cfg.engine.custom,
  });
  return {
    root,
    skill,
    output,
    cfg,
    loader,
    cases,
    agent,
    runner: newRunner(cfg, loader),
  };
}
test("runner plans authoritative report identity, global task order and auto iteration without mutation", async (t) => {
  const s = await setup(t);
  s.cfg.benchmark.enabled = true;
  s.cfg.environment.type = "docker";
  s.cfg.environment.image = "node:22";
  await mkdir(path.join(s.output, "iteration-2"), { recursive: true });
  const plan = await s.runner.buildExecutionPlan(s.cases, {
    outputDir: s.output,
  });
  assert.equal(plan.skillName, "directory-name");
  assert.equal(plan.reportName, "skilled-improve");
  assert.equal(plan.taskPlan.startIteration, 3);
  assert.equal(plan.taskPlan.taskTotal, 6);
  assert.equal(plan.skillDir, s.skill);
  assert.equal(plan.caseCount, 3);
  assert.deepEqual(await readdir(s.output), ["iteration-2"]);
  const multi = await s.runner.buildExecutionPlan(s.cases, { iteration: 2 });
  assert.equal(
    multi.workspaceDir,
    path.join(s.root, "directory-name-workspace"),
  );
  assert.equal(multi.taskPlan.taskTotal, 12);
  assert.equal(multi.taskPlan.iterations[1].tasks[0].globalIndex, 7);
});
test("workspace initialization cleans requested iteration only and preserves cancelled artifacts", async (t) => {
  const s = await setup(t);
  await mkdir(path.join(s.output, "iteration-1"), { recursive: true });
  await mkdir(path.join(s.output, "iteration-2"));
  await writeFile(path.join(s.output, "iteration-1/keep"), "old");
  await writeFile(path.join(s.output, "iteration-2/stale"), "old");
  await s.runner.initWorkspace(s.output, "test", 2);
  assert.equal(
    await readFile(path.join(s.output, "iteration-1/keep"), "utf8"),
    "old",
  );
  await assert.rejects(readFile(path.join(s.output, "iteration-2/stale")));
  await assert.rejects(
    s.runner.initWorkspace(s.output, "test", 1, AbortSignal.abort()),
    { name: "AbortError" },
  );
  assert.equal(
    await readFile(path.join(s.output, "iteration-1/keep"), "utf8"),
    "old",
  );
  assert.equal(s.runner.workspace()!.iterationNum, 2);
});
test("iteration scan ignores files, noncanonical numbers, suffixes and symlink directories", async (t) => {
  const s = await setup(t);
  assert.equal(await nextIterationNumber(s.output), 1);
  for (const n of [
    "iteration-2",
    "iteration-7",
    "iteration-08",
    "iteration-99-extra",
    "iteration--1",
  ])
    await mkdir(path.join(s.output, n), { recursive: true });
  await writeFile(path.join(s.output, "iteration-100"), "");
  await symlink(
    path.join(s.output, "iteration-7"),
    path.join(s.output, "iteration-101"),
  );
  assert.equal(await nextIterationNumber(s.output), 8);
});
test("report overlap rejects both directions and symlink alias before any deletion", async (t) => {
  const s = await setup(t);
  const plan = await s.runner.buildExecutionPlan(s.cases, {
    outputDir: s.output,
    iteration: 1,
  });
  await mkdir(path.join(s.output, "iteration-1"), { recursive: true });
  await writeFile(path.join(s.output, "iteration-1/keep"), "keep");
  await symlink(s.output, path.join(s.root, "alias"));
  for (const external of [
    s.output,
    path.join(s.output, "iteration-1/nested"),
    path.join(s.root, "alias/iteration-1"),
  ])
    await assert.rejects(
      s.runner.evaluatePlan(plan, s.agent, { workspaceDir: external }),
      /overlaps external workspace/,
    );
  assert.equal(
    await readFile(path.join(s.output, "iteration-1/keep"), "utf8"),
    "keep",
  );
  await validateExternalWorkspaceOutput(plan, path.join(s.root, "sibling"));
  assert.equal(
    await canonicalizePotentialPath(path.join(s.root, "alias/missing/new")),
    path.join(await realpath(s.output), "missing/new"),
  );
  assert.equal(
    await pathsOverlap(s.output, path.join(s.root, "alias/iteration-1")),
    true,
  );
  await symlink(
    path.join(s.root, "missing-target"),
    path.join(s.root, "broken"),
  );
  await assert.rejects(canonicalizePotentialPath(path.join(s.root, "broken")));
});
for (const runtime of ["none", "docker"])
  test(
    `actual ${runtime} runner: two iterations, ${runtime === "docker" ? "isolated baseline" : "single configuration"}, global observers and every report`,
    {
      timeout: 240_000,
      skip:
        runtime === "docker" && process.env.SKILLED_DOCKER_INTEGRATION !== "1",
    },
    async (t) => {
      const s = await setup(t);
      s.cfg.environment.type = runtime;
      s.cfg.benchmark.enabled = runtime !== "none";
      const configurations = runtime === "none"
        ? ["with_skill"] : ["with_skill", "without_skill"];
      const perIteration = 3 * configurations.length;
      if (runtime === "docker") s.cfg.environment.image = "node:22";
      const events: string[] = [],
        taskStarts: number[] = [],
        taskEnds: number[] = [];
      let output = "";
      const restore = setOutput({
        write: (text: unknown) => {
          output += String(text);
          return true;
        },
      });
      t.after(async () => restore());
      const opts = {
        outputDir: s.output,
        iteration: 2,
        deleteWorkspace: true,
        formats: ["json", "junit", "html"],
        iterationObserver: {
          onIterationStart: (_: unknown, i: { number: number }) =>
            events.push(`start:${i.number}`),
          onIterationComplete: (
            _: unknown,
            i: { number: number },
            r: EvalResult[],
          ) => events.push(`complete:${i.number}:${r.length}`),
        },
        taskObserver: {
          onTaskStart: (_: unknown, v: { globalIndex: number }) => {
            taskStarts.push(v.globalIndex);
          },
          onTaskComplete: (_: unknown, v: { globalIndex: number }) => {
            taskEnds.push(v.globalIndex);
          },
        },
      };
      const results = await s.runner.evaluate(
        s.cases,
        s.agent,
        opts,
        AbortSignal.timeout(220_000),
      );
      assert.deepEqual(
        results.map((r) => r.status),
        Array.from({ length: 2 }, () => ["PASS", "FAIL", "PASS"].flatMap(
          (status) => configurations.map(() => status),
        )).flat(),
      );
      assert.deepEqual(events, [
        "start:1",
        `complete:1:${perIteration}`,
        "start:2",
        `complete:2:${perIteration}`,
      ]);
      assert.deepEqual(
        taskStarts.sort((a, b) => a - b),
        Array.from({ length: perIteration * 2 }, (_, i) => i + 1),
      );
      assert.deepEqual(
        taskEnds.sort((a, b) => a - b),
        taskStarts,
      );
      for (const i of [1, 2]) {
        const iter = path.join(s.output, `iteration-${i}`),
          json = JSON.parse(
            await readFile(path.join(iter, "result.json"), "utf8"),
          );
        assert.equal(json.skill_name, "skilled-improve");
        assert.equal(json.case_results.length, perIteration);
        assert.equal(json.engine_name, "hash-worker");
        assert.deepEqual(
          JSON.parse(await readFile(path.join(iter, "report.json"), "utf8")),
          json,
        );
        assert.match(
          await readFile(path.join(iter, "report.xml"), "utf8"),
          /failures="1"/,
        );
        assert.match(
          await readFile(path.join(iter, "report.html"), "utf8"),
          /hash-multiturn/,
        );
        const benchmark = JSON.parse(
          await readFile(path.join(iter, "benchmark.json"), "utf8"),
        );
        assert.equal(benchmark.runs.length, perIteration);
        assert.equal(benchmark.runs[0].run_number, i);
        for (const config of configurations) {
          const r = results.find(
            (r) => r.caseID === "hash-pass" && r.configuration === config,
          )!;
          assert.equal(
            await readFile(
              path.join(iter, "hash-pass", config, "outputs/response.md"),
              "utf8",
            ),
            r.final_message + "\n",
          );
          assert.equal(
            JSON.parse(
              await readFile(
                path.join(iter, "hash-pass", config, "grading.json"),
                "utf8",
              ),
            ).summary.pass_rate,
            1,
          );
        }
        assert.equal(
          JSON.parse(
            await readFile(
              path.join(iter, "hash-pass/eval_metadata.json"),
              "utf8",
            ),
          ).eval_name,
          "Real hash pass",
        );
      }
      assert.match(output, /Iteration stability summary:/);
      assert.match(output, /hash-pass: 2 trials, 2 PASS/);
      assert.doesNotMatch(output, /hash-pass: 4 trials/);
      const plan = await s.runner.buildExecutionPlan(s.cases, {
        outputDir: s.output,
      });
      assert.equal(plan.taskPlan.startIteration, 3);
    },
  );
test("runner cancellation returns completed iterations, keeps old artifacts and never starts future iteration", async (t) => {
  const s = await setup(t),
    controller = new AbortController();
  const options = {
    outputDir: s.output,
    iteration: 3,
    deleteWorkspace: true,
    iterationObserver: {
      onIterationStart: () => {},
      onIterationComplete: () => controller.abort(),
    },
  };
  let failure: unknown;
  try {
    await s.runner.evaluate([s.cases[0]], s.agent, options, controller.signal);
  } catch (e) {
    failure = e;
  }
  assert.ok(failure instanceof EvaluationError);
  assert.equal(failure.results.length, 1);
  assert.deepEqual(await readdir(s.output), ["iteration-1"]);
  assert.ok(await readFile(path.join(s.output, "iteration-1/result.json")));
});
test("runner preserves prior iteration results when next workspace creation fails", async (t) => {
  const s = await setup(t);
  const options = {
    outputDir: s.output,
    iteration: 2,
    deleteWorkspace: true,
    iterationObserver: {
      onIterationStart: () => {},
      onIterationComplete: () => {
        renameSync(s.output, s.output + "-saved");
        writeFileSync(s.output, "blocked");
      },
    },
  };
  await assert.rejects(
    s.runner.evaluate([s.cases[0]], s.agent, options),
    (e: unknown) =>
      e instanceof EvaluationError &&
      e.results.length === 1 &&
      /failed to init workspace for run 2/.test(e.message),
  );
  assert.equal(await readFile(s.output, "utf8"), "blocked");
  assert.ok(
    await readFile(
      path.join(
        s.output + "-saved",
        "iteration-1/hash-pass/with_skill/outputs/workspace/results/digest.txt",
      ),
    ),
  );
});
test("runner report writing failure is warned without losing actual evaluation results", async (t) => {
  const s = await setup(t);
  let logged = "";
  const restore = setLogOutput({
    write: (v: unknown) => {
      logged += String(v);
      return true;
    },
  });
  t.after(async () => restore());
  await s.runner.initWorkspace(s.output, "skilled-improve", 1);
  // Unsupported formats are intentionally ignored by source.
  const result = await s.runner.evaluate([s.cases[0]], s.agent, {
    outputDir: s.output,
    iteration: 1,
    deleteWorkspace: true,
    formats: ["json", "unknown"],
    iterationObserver: {
      onIterationStart: () => {},
      onIterationComplete: () => {
        mkdirSync(path.join(s.output, "iteration-1/report.json"));
      },
    },
  });
  assert.equal(result.length, 1);
  await assert.rejects(
    readFile(path.join(s.output, "iteration-1/report.unknown")),
  );
  // An invalid case ID exercises a real filesystem write refusal through the public report boundary.
  await assert.rejects(
    s.runner.writeResults(
      [{ ...result[0], caseID: "../escape" }],
      "skill",
      s.skill,
      1,
      [],
      new Date(),
      new Date(),
    ),
    /invalid case ID/,
  );
  assert.equal(logged.includes("failed to write results for run 1"), true);
});
test("report errors without workspace, response fallback and stability include source edge behavior", async (t) => {
  const s = await setup(t);
  await assert.rejects(
    s.runner.writeResults([], "x", "x", 1, [], new Date(), new Date()),
    /workspace not initialized/,
  );
  const base: EvalResult = {
    caseID: "id",
    caseName: "name",
    prompt: "p",
    configuration: "with_skill",
    status: "PASS",
    turnsTotal: 1,
    turns: 1,
    duration_ms: 10,
    exit_code: 0,
    stderr: "diagnostic",
  };
  assert.equal(responseContent(base), "");
  assert.equal(responseContent({ ...base, exit_code: 1 }), "diagnostic");
  assert.equal(
    responseContent({ ...base, error: new Error("err") }),
    "diagnostic",
  );
  assert.equal(responseContent({ ...base, final_message: "answer" }), "answer");
  const summaries = buildIterationStabilitySummaries([
    base,
    { ...base, status: "FAIL" },
    { ...base, configuration: "without_skill" },
  ]);
  assert.equal(
    formatIterationStabilitySummary(summaries[0]),
    "id: 2 trials, 1 PASS, 1 FAIL -> flaky",
  );
  assert.equal(
    formatIterationStabilitySummary({
      caseID: "x",
      trials: 3,
      counts: { WAIT: 1, ZZZ: 2 },
    }),
    "x: 3 trials, 1 WAIT, 2 ZZZ -> flaky",
  );
  const results = [
    { ...base, model: "m", version: "v", input_tokens: 2, output_tokens: 3 },
    {
      ...base,
      caseID: "other",
      model: "m",
      input_tokens: 5,
      output_tokens: 7,
      judgeSession: {
        exit_code: 1,
        duration_ms: 30,
        turns: 1,
        input_tokens: 11,
        output_tokens: 13,
      },
    },
  ];
  const input = buildReportInput(
    "s",
    groupResultsByCase(results),
    indexCaseResults(results),
    new Date(),
    new Date(),
    s.cfg,
  );
  assert.equal(input.total_tokens, 17);
  assert.equal(input.judge_tokens, 24);
  assert.equal(input.overall_tokens, 41);
  assert.deepEqual(input.observed_configuration, { model: "m", version: "" });
});
test("single-configuration runner appends auto iterations and writes real multi-judge grouped artifacts", async (t) => {
  const s = await setup(t);
  s.cfg.benchmark.enabled = false;
  const check = path.join(s.skill, "check.sh");
  await writeFile(
    check,
    "#!/bin/sh\nset -eu\ntest -s results/digest.txt\nprintf 'verified generated digest'\n",
  );
  const raw = structuredClone(fixture.cases[0]);
  delete raw.judge;
  const cfg = decode<CaseConfig>("CaseConfig", {
    ...raw,
    judges: [{ id: "digest-file", type: "script", script_path: check }],
  });
  const options = { outputDir: s.output, deleteWorkspace: true };
  const first = await s.runner.evaluate([cfg], s.agent, options);
  assert.equal(first.length, 1);
  assert.equal(
    first[0].status,
    "PASS",
    first[0].error?.message + JSON.stringify(first[0].judgeResults),
  );
  const evaluation = JSON.parse(
    await readFile(
      path.join(s.output, "iteration-1/hash-pass/with_skill/evaluation.json"),
      "utf8",
    ),
  );
  assert.equal(evaluation.version, 1);
  assert.equal(evaluation.judge_results[0].id, "digest-file");
  assert.equal(evaluation.aggregation.status, "PASS");
  await assert.rejects(
    readdir(path.join(s.output, "iteration-1/hash-pass/without_skill")),
  );
  const original = await readFile(
    path.join(s.output, "iteration-1/result.json"),
    "utf8",
  );
  const second = await s.runner.evaluate([cfg], s.agent, options);
  assert.equal(second.length, 1);
  assert.equal(s.runner.workspace()!.iterationNum, 2);
  assert.equal(
    await readFile(path.join(s.output, "iteration-1/result.json"), "utf8"),
    original,
  );
});
