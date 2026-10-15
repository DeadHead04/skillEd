import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import os from "node:os";
import { JSONReporter } from "../../src/report/json.js";
import { MarkdownReporter } from "../../src/report/markdown.js";
import { JUnitReporter } from "../../src/report/junit.js";
import { HTMLReporter } from "../../src/report/html.js";
import {
  computeBenchmark,
  type CaseMetrics,
} from "../../src/report/benchmark.js";
import {
  computeAnthropicBenchmark,
  withTimestamp,
} from "../../src/report/benchmark-anthropic.js";
import { writeBenchmarkMarkdownFile } from "../../src/report/benchmark-md.js";
import {
  writeGradingJSON,
  writeEvalMetadata,
} from "../../src/report/grading.js";
import { writeAnthropicBenchmark } from "../../src/report/benchmark-anthropic.js";
import type { Input } from "../../src/report/reporter.js";
const currentLogo = (await readFile(
  new URL("../../../assets/report/logo.png", import.meta.url),
)).toString("base64");
const vectors = JSON.parse(
  gunzipSync(
    await readFile(
      new URL(
        "../../../tests/report/reference-vectors.json.gz",
        import.meta.url,
      ),
    ),
  ).toString("utf8"),
);
function equalNumbers(actual: any, expected: any): void {
  if (typeof actual === "number" && typeof expected === "number") {
    assert.ok(
      Object.is(actual, expected) ||
        Math.abs(actual - expected) <=
          Number.EPSILON * 8 * Math.max(1, Math.abs(expected)),
      `${actual} differs from ${expected}`,
    );
    return;
  }
  if (
    actual &&
    expected &&
    typeof actual === "object" &&
    typeof expected === "object"
  ) {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
    for (const key of Object.keys(expected))
      equalNumbers(actual[key], expected[key]);
    return;
  }
  assert.deepEqual(actual, expected);
}
const rows = (v: any[] | null): CaseMetrics[] | null =>
  v?.map((r) => ({
    passed: r.Passed,
    time_seconds: r.TimeSeconds,
    input_tokens: r.InputTokens,
    output_tokens: r.OutputTokens,
  })) ?? null;
for (const [i, v] of vectors.entries())
  test(`original Go report vector ${i + 1}: ${v.kind}`, async () => {
    if (v.kind === "benchmark") {
      equalNumbers(computeBenchmark(rows(v.with), rows(v.without)), v.output);
      return;
    }
    if (v.kind === "anthropic") {
      equalNumbers(
        computeAnthropicBenchmark(
          v.name,
          v.path,
          v.with,
          v.without,
          withTimestamp(v.output.metadata.timestamp),
        ),
        v.output,
      );
      return;
    }
    const root = await mkdtemp(
      path.join(os.tmpdir(), "skilled-report-parity-"),
    );
    try {
      const file = path.join(root, "artifact"),
        input = v.input as Input;
      if (
        ["grading", "metadata", "benchmark_json", "benchmark_md"].includes(
          v.kind,
        )
      ) {
        const writers = {
          grading: writeGradingJSON,
          metadata: writeEvalMetadata,
          benchmark_json: writeAnthropicBenchmark,
          benchmark_md: writeBenchmarkMarkdownFile,
        };
        await writers[v.kind as keyof typeof writers](file, v.input);
        const text = await readFile(file, "utf8");
        if (v.kind === "benchmark_md") assert.equal(text, v.output);
        else assert.deepEqual(JSON.parse(text), JSON.parse(v.output));
        return;
      }
      const reporters = {
        JSONReporter,
        MarkdownReporter,
        JUnitReporter,
        HTMLReporter,
      };
      const Reporter = reporters[v.kind as keyof typeof reporters];
      await new Reporter(file).write(input);
      const actual = await readFile(file, "utf8");
      if (v.kind === "JSONReporter")
        assert.deepEqual(JSON.parse(actual), JSON.parse(v.output));
      else if (v.kind === "HTMLReporter") {
        const extract = (html: string) => {
          const match = html.match(/var DATA = (.*);/)!;
          return {
            data: JSON.parse(match[1]!),
            html: html.replace(match[1]!, "EMBEDDED_REPORT_DATA"),
          };
        };
        // Adapt only intentional presentation changes; all report data and other HTML stay exact.
        const updatedTemplate = v.output
          .replace(/data:image\/png;base64,[^"]+/, `data:image/png;base64,${currentLogo.replaceAll("+", "&#43;")}`)
          .replace('var sc = exp.passed ?', 'var sc = exp.skipped ? "a-skip" : exp.passed ?')
          .replace('var icon = exp.passed ?', 'var icon = exp.skipped ? "SKIP" : exp.passed ?');
        assert.deepEqual(extract(actual), extract(updatedTemplate));
      } else assert.equal(actual, v.output);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
