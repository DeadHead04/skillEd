import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decode } from "../../src/contracts/decode.js";
import type { EvalConfig } from "../../src/contracts/schema.js";
import type { EvalResult } from "../../src/evaluator/types.js";
import {
  buildReportInput,
  indexCaseResults,
  groupResultsByCase,
  evalResultToCaseResult,
  resultToBenchmarkRun,
  buildIterationStabilitySummaries,
  formatIterationStabilitySummary,
} from "../../src/runner/index.js";
import { serializeInput, serializeCaseResult } from "../../src/report/json.js";
import { goJSON } from "../../src/report/helpers.js";
const vectors = JSON.parse(
  await readFile(
    new URL("../../../tests/runner/reference-results.json", import.meta.url),
    "utf8",
  ),
);
for (const vector of vectors)
  test(`original Go runner helper parity: ${vector.name}`, () => {
    const cfg = decode<EvalConfig>("EvalConfig", vector.eval);
    const results: EvalResult[] = vector.results.map(
      (r: Record<string, unknown>) => ({
        ...r,
        error: r.error ? new Error(String(r.error)) : undefined,
      }),
    );
    const caseIDs = indexCaseResults(results),
      grouped = groupResultsByCase(results);
    const output = {
      report: serializeInput(
        buildReportInput(
          "skilled-improve",
          grouped,
          caseIDs,
          "2026-10-11T00:00:00Z",
          "2026-10-11T00:00:01Z",
          cfg,
        ),
      ),
      caseResults: results.map((r) =>
        serializeCaseResult(evalResultToCaseResult(r)),
      ),
      benchmark: results.map((r) => resultToBenchmarkRun(r, 3)),
      stability: buildIterationStabilitySummaries(results).map(
        formatIterationStabilitySummary,
      ),
      caseIDs,
    };
    assert.deepEqual(JSON.parse(goJSON(output)), vector.expected);
  });
