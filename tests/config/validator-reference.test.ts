import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decode } from "../../src/contracts/decode.js";
import type { EvalConfig, CaseConfig } from "../../src/contracts/schema.js";
import {
  validateEvalConfig,
  validateCaseConfig,
} from "../../src/config/validator.js";
const vectors: Array<{ kind: string; input: unknown; error: string }> =
  JSON.parse(
    await readFile(
      new URL(
        "../../../tests/config/validator-reference.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
// Inputs and expectations were recorded while executing the pinned original real validator tests.
// We invoke production TS directly: no substitute validators, transports or mocking framework.
for (const [i, v] of vectors.entries())
  test(`source validator contract ${i + 1} ${v.kind}`, () => {
    let actual = "";
    try {
      if (v.kind === "EvalConfig")
        validateEvalConfig(decode<EvalConfig>("EvalConfig", v.input));
      else validateCaseConfig(decode<CaseConfig>("CaseConfig", v.input));
    } catch (e) {
      actual = (e as Error).message;
    }
    assert.equal(
      !actual,
      !v.error,
      `decision mismatch: ${actual}\nexpected: ${v.error}`,
    );
    // Go map iteration can reorder independent details; RE2 diagnostic wording differs by binding.
    const details = (message: string) =>
      message
        .split("\n  - ")
        .map((x) => x.replace(/(is invalid regex(?: "[^"]*")?):.*/, "$1"))
        .sort();
    assert.deepEqual(details(actual), details(v.error));
  });
