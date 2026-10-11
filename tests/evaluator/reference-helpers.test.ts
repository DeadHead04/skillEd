import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decode } from "../../src/contracts/decode.js";
import type { CaptureRule, PostCondition } from "../../src/contracts/schema.js";
import {
  normalizeSessionResult,
  type SessionResult,
} from "../../src/agent/types.js";
import {
  captureVariables,
  substituteTemplate,
  evaluatePostCondition,
  transcriptForLogicalTurn,
  normalizeTurnSessionResult,
  normalizeIncrementalTurnSessionResult,
  newMultiTurnState,
  accumulateCumulativeMetrics,
  accumulatePerTurnMetrics,
  mergeTurnArtifacts,
} from "../../src/evaluator/multiturn.js";
const data = JSON.parse(
  await readFile(
    new URL("../../../tests/evaluator/reference-helpers.json", import.meta.url),
    "utf8",
  ),
);
const wire = (result: SessionResult | null) =>
  result ? JSON.parse(JSON.stringify(normalizeSessionResult(result))) : null;
function execute(r: any): unknown {
  switch (r.op) {
    case "capture":
      try {
        return {
          value: captureVariables(
            r.rules.map((v: any) => decode<CaptureRule>("CaptureRule", v)),
            r.text,
          ),
          error: "",
        };
      } catch (e) {
        return { value: null, error: (e as Error).message };
      }
    case "substitute":
      try {
        return { value: substituteTemplate(r.text, r.vars), error: "" };
      } catch (e) {
        return { value: "", error: (e as Error).message };
      }
    case "post":
      return evaluatePostCondition(
        r.post === null ? null : decode<PostCondition>("PostCondition", r.post),
        r.text,
      );
    case "delta": {
      const result = transcriptForLogicalTurn(r.current, r.previous, r.turn);
      return {
        transcript: r.current.length ? result.transcript : null,
        cumulative: result.cumulative,
      };
    }
    case "normalize": {
      const result = normalizeTurnSessionResult(r.result, r.turn, r.previous);
      return { result: wire(result.result), cumulative: result.cumulative };
    }
    case "incremental":
      return wire(normalizeIncrementalTurnSessionResult(r.result, r.turn));
    case "metrics": {
      const state = newMultiTurnState(),
        history: unknown[] = [];
      for (const step of r.steps) {
        if (step.result?.artifacts)
          Object.defineProperty(
            step.result.artifacts,
            "generated_file_sources",
            {
              value: step.sources ?? [],
              enumerable: false,
              configurable: true,
            },
          );
        if (step.mode === "cumulative")
          accumulateCumulativeMetrics(state, step.result);
        else accumulatePerTurnMetrics(state, step.result);
        mergeTurnArtifacts(state, step.result);
        const sources = state.artifacts?.generated_file_sources;
        const session = wire({
          exit_code: 0,
          duration_ms: 0,
          turns: 0,
          artifacts: state.artifacts,
        });
        history.push({
          inputTokens: state.inputTokens,
          outputTokens: state.outputTokens,
          tokenBaseIn: state.tokenBaseIn,
          tokenBaseOut: state.tokenBaseOut,
          durationMs: state.durationMs,
          artifacts: session.artifacts ?? null,
          sources: sources?.length ? [...sources] : null,
        });
      }
      return history;
    }
  }
  throw new Error("unknown oracle op");
}
for (const [index, vector] of data.vectors.entries())
  test(`original Go evaluator helper ${index + 1}: ${vector.request.op}`, () => {
    const actual: any = execute(structuredClone(vector.request));
    if (vector.runtimeSpecificDiagnostic) {
      assert.equal(actual.value, null);
      assert(actual.error);
      const prefix = vector.expected.error.split(": ")[0];
      assert(actual.error.startsWith(prefix + ": "));
    } else
      assert.deepEqual(actual, vector.expected, JSON.stringify(vector.request));
  });
