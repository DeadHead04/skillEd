import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import type { EvalConfig, CaseConfig } from "../../src/contracts/schema.js";
import { decode } from "../../src/contracts/decode.js";
import { Loader } from "../../src/config/loader.js";
import { detectAgent } from "../../src/agent/factory.js";
import { newEvaluator } from "../../src/evaluator/index.js";
import {
  JSONReporter,
  JUnitReporter,
  MarkdownReporter,
  HTMLReporter,
  newInput,
  newCaseResult,
  overallPassRate,
  computeBenchmark,
  extractMetrics,
} from "../../src/report/index.js";
import type { EvalResult } from "../../src/evaluator/types.js";
const fixtureRoot = fileURLToPath(
  new URL("../../../tests/integration/phase3/", import.meta.url),
);
const spec = JSON.parse(
  await readFile(path.join(fixtureRoot, "config.json"), "utf8"),
);
const expected = JSON.parse(
  await readFile(path.join(fixtureRoot, "reference-results.json"), "utf8"),
);
function project(r: EvalResult) {
  return {
    caseID: r.caseID,
    configuration: r.configuration,
    status: r.status,
    turnsTotal: r.turnsTotal,
    grading: r.grading ?? null,
    final_message: r.final_message ?? "",
    exit_code: r.exit_code,
    turns: r.turns,
    input_tokens: r.input_tokens ?? 0,
    output_tokens: r.output_tokens ?? 0,
    ...(r.error ? { error: r.error.message } : {}),
  };
}
for (const runtime of ["none", "docker", "opensandbox"])
  test(
    `Phase3 actual ${runtime} evaluation, Go verdict parity, artifacts and all reports`,
    {
      skip:
        runtime === "docker"
          ? process.env.SKILLED_DOCKER_INTEGRATION !== "1"
          : runtime === "opensandbox"
            ? process.env.SKILLED_REAL_OPENSANDBOX !== "1"
            : false,
      timeout: 240_000,
    },
    async (t) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "skilled-pipeline-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      await mkdir(path.join(root, "evals"), { recursive: true });
      await writeFile(
        path.join(root, "SKILL.md"),
        "---\nname: skilled-improve\ndescription: Direct language migration parity\n---\nHash inputs.\n",
      );
      const evalCfg = decode<EvalConfig>(
        "EvalConfig",
        structuredClone(spec.eval),
      );
      evalCfg.environment.type = runtime;
      evalCfg.environment.image = runtime === "none" ? "" : "node:22";
      evalCfg.environment.ready_timeout_seconds = 90;
      evalCfg.environment.sandbox_timeout_seconds = 300;
      if (runtime === "opensandbox") {
        evalCfg.environment.use_server_proxy =
          process.env.SKILLED_REAL_OPENSANDBOX_PROXY === "1";
        evalCfg.environment.kwargs = {
          base_url: process.env.SKILLED_REAL_OPENSANDBOX_BASE_URL ?? "",
          request_timeout_seconds: "60",
        };
      }
      await writeFile(
        path.join(root, "evals/eval.yaml"),
        JSON.stringify(evalCfg),
      );
      const loader = await Loader.create(path.join(root, "evals/eval.yaml"));
      const cases = spec.cases.map((v: unknown) =>
        decode<CaseConfig>("CaseConfig", v),
      );
      const outputDir = path.join(root, "output");
      const evaluator = newEvaluator({
        skillName: "skilled-improve",
        skillDir: root,
        outputDir,
        concurrency: 2,
        withBaseline: true,
        deleteWorkspace: true,
        loader,
        evalCfg,
        agent: detectAgent(evalCfg.engine.name, {
          name: evalCfg.engine.name,
          custom: evalCfg.engine.custom,
        }),
      });
      const started = new Date();
      const results = await evaluator.evaluateAll(
        cases,
        AbortSignal.timeout(200_000),
      );
      assert.deepEqual(results.map(project), expected);
      assert.deepEqual(
        results.map((r) => r.status),
        ["PASS", "PASS", "FAIL", "FAIL", "PASS", "PASS"],
      );
      for (const r of results) {
        const directPath = path.join(
          outputDir,
          r.caseID,
          r.configuration,
          "outputs/agent/run",
          ...(r.turnsTotal > 1 ? [`turn-${r.turnsTotal}`] : []),
          "digest.txt",
        );
        assert.equal(
          await readFile(directPath, "utf8"),
          r.final_message,
          "direct generated-file download must preserve exact content",
        );
        if (runtime === "opensandbox") continue;
        const digest = await readFile(
          path.join(
            outputDir,
            r.caseID,
            r.configuration,
            "outputs/workspace/results/digest.txt",
          ),
          "utf8",
        );
        assert.equal(digest, r.final_message);
      }
      if (runtime === "opensandbox")
        t.diagnostic(
          "UPSTREAM LIMIT: tested execd strips stdout line separators in both original Go and TypeScript; glob-based artifact collection is not certified. Direct downloads, verdicts and reports are checked. See migration/phase3-opensandbox-source-lines.log.",
        );
      const report = newInput({
        skill_name: "skilled-improve",
        schema_version: "v1alpha1",
        engine_name: "hash-worker",
        model_name: "",
        start_time: started,
        end_time: new Date(),
        case_results: results.map((r) =>
          newCaseResult({
            case_id: r.caseID,
            title: r.caseName,
            status: r.status,
            duration_ms: r.duration_ms,
            turns: r.turns,
            input_tokens: r.input_tokens ?? 0,
            output_tokens: r.output_tokens ?? 0,
            grading: r.grading ?? null,
            configuration: r.configuration,
            prompt: r.prompt,
            response: r.final_message,
            turn_results: r.turnResults?.map((turn) => ({
              turn_number: turn.turnNumber,
              content: turn.content,
              response: turn.response ?? "",
              status: turn.status,
              reason: turn.reason,
              captured_vars: turn.capturedVars,
            })),
          }),
        ),
      });
      report.benchmark = computeBenchmark(
        extractMetrics(
          report.case_results!.filter((r) => r.configuration === "with_skill"),
        ),
        extractMetrics(
          report.case_results!.filter(
            (r) => r.configuration === "without_skill",
          ),
        ),
      );
      assert.equal(overallPassRate(report), 2 / 3);
      const reportDir = path.join(root, "reports");
      await mkdir(reportDir);
      await new JSONReporter(path.join(reportDir, "report.json")).write(report);
      await new JUnitReporter(path.join(reportDir, "junit.xml")).write(report);
      await new MarkdownReporter(path.join(reportDir, "report.md")).write(
        report,
      );
      await new HTMLReporter(path.join(reportDir, "report.html")).write(report);
      const json = JSON.parse(
        await readFile(path.join(reportDir, "report.json"), "utf8"),
      );
      assert.equal(json.case_results.length, 6);
      const xml = await readFile(path.join(reportDir, "junit.xml"), "utf8");
      assert.match(xml, /tests="3"/);
      assert.match(xml, /failures="1"/);
      const html = await readFile(path.join(reportDir, "report.html"), "utf8");
      assert.ok(html.includes("hash-multiturn"));
      assert.ok(html.includes("skilled-improve"));
      assert.match(
        await readFile(path.join(reportDir, "report.md"), "utf8"),
        /66\.7%/,
      );
      if (process.env.SKILLED_PHASE3_REPORT_DIR) {
        await cp(
          reportDir,
          path.join(process.env.SKILLED_PHASE3_REPORT_DIR, runtime),
          { recursive: true },
        );
      }
    },
  );
