import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  newIterationWorkspace,
  validateCaseID,
} from "../../src/report/workspace.js";
import {
  newInput,
  newCaseResult,
  totalDuration,
  primaryCaseResults,
  overallPassRate,
} from "../../src/report/reporter.js";
import { convertToAnthropicGrading } from "../../src/report/grading.js";
import {
  computeAnthropicBenchmark,
  withTimestamp,
} from "../../src/report/benchmark-anthropic.js";
import { JSONReporter } from "../../src/report/json.js";
import { MarkdownReporter } from "../../src/report/markdown.js";
import { JUnitReporter, renderJUnit } from "../../src/report/junit.js";
import { HTMLReporter } from "../../src/report/html.js";
import { fixed } from "../../src/report/helpers.js";
import { newResult } from "../../src/judge/types.js";
test("iteration workspace writes every canonical artifact and rejects source traversal cases on actual disk", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "skilled-report-workspace-"),
  );
  try {
    const w = await newIterationWorkspace(root, "demo", 2);
    await w.ensureDirsWithBaseline(["case-a", "case-b"]);
    assert.equal(w.iterationDir(), path.join(root, "iteration-2"));
    for (const config of ["with_skill", "without_skill"])
      assert.ok(
        (
          await stat(path.join(w.configDir("case-a", config), "outputs"))
        ).isDirectory(),
      );
    const grading = convertToAnthropicGrading(
      newResult([{ text: "expected", passed: true, evidence: "observed" }]),
    );
    await w.writeResponse("case-a", "with_skill", "answer");
    await w.writeGrading("case-a", "with_skill", grading);
    await w.writeEvaluation("case-a", "with_skill", {
      version: 1,
      judge_results: [],
      aggregation: { strategy: "all", status: "PASS" },
    });
    await w.writeEvalMeta("case-a", {
      eval_id: 1,
      eval_name: "a",
      prompt: "hello",
      assertions: ["expected"],
    });
    const bm = computeAnthropicBenchmark(
      "demo",
      "./demo",
      [],
      null,
      withTimestamp("2026-01-01T00:00:00Z"),
    );
    await w.writeBenchmark(bm);
    await w.writeBenchmarkMD(bm);
    await w.writeFile("nested/trace.txt", Buffer.from("trace"));
    assert.equal(
      await readFile(
        path.join(w.withSkillDir("case-a"), "outputs/response.md"),
        "utf8",
      ),
      "answer\n",
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(
          path.join(w.withSkillDir("case-a"), "grading.json"),
          "utf8",
        ),
      ),
      grading,
    );
    assert.equal(
      JSON.parse(
        await readFile(path.join(w.iterationDir(), "benchmark.json"), "utf8"),
      ).metadata.skill_name,
      "demo",
    );
    assert.match(
      await readFile(path.join(w.iterationDir(), "benchmark.md"), "utf8"),
      /# Skill Benchmark: demo/,
    );
    for (const id of ["../escape", "a/b", "a\\b", "/root", "hello..world"])
      assert.throws(() => validateCaseID(id), /invalid case ID/);
    for (const p of ["../escape", "/absolute", "\\absolute", "..hidden"])
      await assert.rejects(
        w.writeFile(p, Buffer.from("bad")),
        /invalid relative path/,
      );
    await assert.rejects(
      newIterationWorkspace(root, "demo", 0),
      /iteration number/,
    );
    await assert.rejects(w.ensureDirs(["../bad"]), /invalid case ID/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("primary aggregate precedence and fallback duration preserve exact source rules", () => {
  const baseline = newCaseResult({
      case_id: "a",
      configuration: "without_skill",
      status: "FAIL",
      duration_ms: 1000,
    }),
    preferred = newCaseResult({
      case_id: "a",
      configuration: "with_skill",
      status: "PASS",
      duration_ms: 2000,
    }),
    other = newCaseResult({
      case_id: "a",
      configuration: "custom",
      status: "ERROR",
      duration_ms: 3000,
    });
  const input = newInput({ case_results: [baseline, preferred, other] });
  assert.deepEqual(primaryCaseResults(input), [preferred]);
  assert.equal(overallPassRate(input), 1);
  assert.equal(totalDuration(input), 6000);
  assert.equal(
    totalDuration({
      ...input,
      start_time: "2026-01-01T00:00:02Z",
      end_time: "2026-01-01T00:00:01Z",
    }),
    -1000,
  );
});
test("all report writers produce real files and report actual filesystem failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skilled-report-files-"));
  try {
    const input = newInput({
      skill_name: "<demo>",
      case_results: [newCaseResult({ case_id: "a", status: "PASS" })],
      total_tokens: 5,
      judge_tokens: 2,
    });
    for (const Reporter of [
      JSONReporter,
      MarkdownReporter,
      JUnitReporter,
      HTMLReporter,
    ]) {
      const file = path.join(root, Reporter.name);
      await new Reporter(file).write(input);
      assert.ok((await stat(file)).size > 0);
      await assert.rejects(
        new Reporter(path.join(root, "missing", Reporter.name)).write(input),
      );
    }
    assert.equal(
      JSON.parse(await readFile(path.join(root, "JSONReporter"), "utf8"))
        .overall_tokens,
      7,
    );
    await assert.rejects(
      new JSONReporter(path.join(root, "nonfinite")).write({
        ...input,
        total_tokens: NaN,
      }),
      /unsupported value/,
    );
    const proc = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {JSONReporter} from './dist/src/report/json.js';import {newInput} from './dist/src/report/reporter.js';await new JSONReporter().write(newInput({skill_name:'stdout'}));`,
      ],
      { cwd: path.resolve(import.meta.dirname, "../../.."), encoding: "utf8" },
    );
    assert.equal(proc.status, 0, proc.stderr);
    assert.equal(JSON.parse(proc.stdout).skill_name, "stdout");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("Go decimal formatting preserves exact binary ties and sign", () => {
  assert.equal(fixed(2.675, 2), "2.67");
  assert.equal(fixed(2.5, 0), "2");
  assert.equal(fixed(3.5, 0), "4");
  assert.equal(fixed(-0, 1, true), "-0.0");
  assert.equal(fixed(0.85, 1), "0.8");
});

test("RFC3339 nanoseconds survive duration subtraction and actual JUnit output", async () => {
  const input = newInput({start_time: "2026-01-01T00:00:00.0009Z", end_time: "2026-01-01T00:00:00.0011Z"});
  assert.equal(totalDuration(input), 0.2);
  assert.match(renderJUnit(input), /time="0.000"/);
  assert.equal(totalDuration({...input, start_time: "2026-01-01T05:30:00.000900000+05:30"}), 0.2);
  assert.equal(totalDuration({...input, start_time: "0001-01-01T00:00:00.000000001Z", end_time: "0001-01-01T00:00:00.000000002Z"}), 0.000001);
  const root = await mkdtemp(path.join(os.tmpdir(), "skilled-report-nanoseconds-"));
  try {
    const file = path.join(root, "report.xml");
    await new JUnitReporter(file).write(input);
    assert.match(await readFile(file, "utf8"), /time="0.000"/);
    await assert.rejects(new JSONReporter(path.join(root,"missing","result.json")).write(input), /^Error: create json report file:/);
    await assert.rejects(new JSONReporter(file).write({...input,total_tokens:NaN}), /^Error: json marshal:/);
  } finally { await rm(root,{recursive:true,force:true}); }
});
