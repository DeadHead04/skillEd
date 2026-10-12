import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, open } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compareResults, compareResultFiles, parseComparisonInput, MAX_COMPARISON_FILE_BYTES } from "../../src/report/compare.js";
import { newInput, newCaseResult } from "../../src/report/reporter.js";
import { renderJSON } from "../../src/report/json.js";
import { newResult, newSkipResult, type Status } from "../../src/judge/types.js";

function row(id: string, verdict: Status = "PASS", configuration = "with_skill", passes = [true, true]) {
  return newCaseResult({ case_id: id, configuration, status: verdict, prompt: "Analyze the fixture", grading: newResult(passes.map((passed, i) => ({text: `Criterion ${i}`, passed, evidence: "checked"}))) });
}
function report(rows = [row("a")]) {
  return newInput({ skill_name: "demo", schema_version: "1.0", engine_name: "codex", model_name: "configured", case_results: rows });
}

test("comparison joins case ID and configuration, preserving baseline variants and coverage changes", () => {
  const before = report([row("a"), row("a", "FAIL", "without_skill", [false, false]), row("removed")]);
  const after = report([row("added"), row("a", "PASS", "without_skill"), row("a", "FAIL", "with_skill", [true, false])]);
  const result = compareResults(before, after);
  assert.deepEqual(result.summary, {before:3, after:3, matched:2, added:1, removed:1, changed:2, unchanged:0, statusChanges:2, regressions:1, improvements:1, comparableScores:2});
  assert.equal(result.hasRegressions, true);
  assert.equal(result.cases.find(c => c.configuration === "with_skill" && c.caseID === "a")?.score?.delta, -0.5);
  assert.match(result.warnings.join(" "), /do not prove equivalent inputs/);
  assert.match(result.warnings.join(" "), /coverage changed/i);
});

test("unchanged FAIL verdict still detects an assertion pass-rate regression", () => {
  const result = compareResults(report([row("a", "FAIL", "with_skill", [true, false])]), report([row("a", "FAIL", "with_skill", [false, false])]));
  assert.equal(result.summary.statusChanges, 0);
  assert.equal(result.summary.regressions, 1);
  assert.equal(result.cases[0].change, "changed");
});

test("missing provenance and changed rubric never manufacture comparable scores", () => {
  const before = report(), after = report();
  after.case_results![0].grading!.assertion_results[0].text = "Different criterion";
  assert.equal(compareResults(before, after).summary.comparableScores, 0);
  after.case_results![0].grading = newResult([{text:"Criterion 0",passed:false,evidence:""},{text:"Criterion 1",passed:true,evidence:""}]);
  after.case_results![0].prompt = "A different task";
  assert.match(compareResults(before, after).cases[0].warnings.join(" "), /Prompts differ/);
  delete after.case_results![0].prompt;
  assert.match(compareResults(before, after).cases[0].warnings.join(" "), /Prompt provenance is missing/);
  assert.equal(compareResults(before, after).summary.comparableScores, 0);
  assert.match(compareResults({case_results:[]}, {case_results:[]}).warnings.join(" "), /Missing skillName provenance/);
});

test("different judge identities and incompatible report identities suppress score deltas", () => {
  const before = report(), after = report();
  before.case_results![0].judge_results = [{id:"rubric",type:"script",status:"PASS",duration_ms:1}];
  after.case_results![0].judge_results = [{id:"rubric",type:"agent_judge",status:"PASS",duration_ms:1}];
  assert.equal(compareResults(before, after).summary.comparableScores, 0);
  delete before.case_results![0].judge_results; delete after.case_results![0].judge_results;
  after.skill_name = "other";
  const comparison = compareResults(before, after);
  assert.equal(comparison.summary.comparableScores, 0);
  assert.match(comparison.warnings.join(" "), /skillName differs/);
});

test("SKIP, ERROR and gate failures have no score; lost PASS is an observed regression", () => {
  for (const status of ["SKIP", "ERROR", "FAIL"] as const) {
    const after = row("a", status); after.grading = newSkipResult("expect_gate_failed");
    const result = compareResults(report(), report([after]));
    assert.equal(result.summary.comparableScores, 0);
    assert.equal(result.summary.regressions, 1);
  }
  const empty = row("a"); empty.grading = newResult([]);
  assert.equal(compareResults(report(), JSON.parse(renderJSON(report([empty])))).summary.comparableScores, 0);
  const after = row("a"); after.grading = null;
  assert.equal(compareResults(report(), report([after])).summary.comparableScores, 0);
});

test("strict input validation rejects malformed reports, duplicate joins and JSON properties", () => {
  for (const value of [null, [], {}, {case_results: null}, {case_results: [null]}, {case_results:[{case_id:"x",status:"UNKNOWN"}]}, {case_results:[{case_id:"",status:"PASS"}]}, {case_results:[{case_id:"x",configuration:2,status:"PASS"}]}])
    assert.throws(() => compareResults(value, report()));
  assert.throws(() => compareResults(report([row("a"),row("a")]), report()), /duplicate case key/);
  assert.throws(() => parseComparisonInput('{"case_results":[],"case_results":[]}'), /duplicate JSON property/);
  assert.throws(() => parseComparisonInput('{"case_results":[],"nested":{"x":1,"\\u0078":2}}'), /duplicate JSON property/);
  assert.throws(() => parseComparisonInput('{'), SyntaxError);
  assert.throws(() => parseComparisonInput('['.repeat(130) + '0' + ']'.repeat(130)), /nesting depth/);
  const malformed = report(); malformed.case_results![0].grading!.summary.pass_rate = Number.NaN;
  assert.throws(() => compareResults(malformed, report()), /finite number/);
  malformed.case_results![0].grading!.summary.pass_rate = 0.5;
  assert.throws(() => compareResults(malformed, report()), /inconsistent counts/);
});

test("real JSONReporter files compare offline and CLI emits JSON before failing regression policy", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skilled-compare-"));
  try {
    const before = path.join(dir,"before.json"), after = path.join(dir,"after.json");
    await writeFile(before, renderJSON(report()));
    await writeFile(after, renderJSON(report([row("a","FAIL","with_skill",[true,false])])));
    const result = await compareResultFiles(before, after);
    assert.equal(result.summary.regressions, 1);
    const driver = fileURLToPath(new URL("../cli/driver.js", import.meta.url));
    const run = (...args: string[]) => spawnSync(process.execPath, [driver,"compare",before,after,...args], {encoding:"utf8",env:{...process.env,OTEL_SDK_DISABLED:"true",SKILLED_CONFIG:""}});
    const json = run("--format","json");
    assert.equal(json.status,0,json.stderr);
    assert.equal(JSON.parse(json.stdout).hasRegressions,true);
    const failure = run("--format","json","--fail-on-regression");
    assert.equal(failure.status,1);
    assert.equal(JSON.parse(failure.stdout).summary.regressions,1);
    assert.match(failure.stderr,/comparison found 1 regression/);
    const text = run(); assert.equal(text.status,0,text.stderr); assert.match(text.stdout,/REGRESSION/);
    const invalid = run("--format","html"); assert.equal(invalid.status,1); assert.match(invalid.stderr,/unsupported comparison format/);
    const missing = spawnSync(process.execPath,[driver,"compare",before,path.join(dir,"missing.json")],{encoding:"utf8"});
    assert.equal(missing.status,1); assert.match(missing.stderr,/ENOENT/);
    await writeFile(after,'{"case_results":[{"case_id":"a","status":"BROKEN"}]}');
    await assert.rejects(compareResultFiles(before,after),/must be PASS/);
    const oversized = await open(after, 'w');
    await oversized.truncate(MAX_COMPARISON_FILE_BYTES + 1);
    await oversized.close();
    await assert.rejects(compareResultFiles(before,after),/32 MiB/);
    await assert.rejects(compareResultFiles(before,dir),/regular file/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
