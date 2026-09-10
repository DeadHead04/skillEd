import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareResults, deriveResult, worstResult } from "../results";
describe("result truthfulness", () => {
  it("cannot turn target-correct scope drift green", () =>
    assert.equal(
      deriveResult([
        { dimension: "correctness", required: true, passed: true },
        { dimension: "scope", required: true, passed: false },
      ]),
      "PARTIAL",
    ));
  it("treats unmapped assertions as errors", () =>
    assert.equal(deriveResult([{ required: true, passed: true }]), "ERROR"));
  it("preserves worst and flakiness", () => {
    assert.equal(worstResult(["PASS", "FAIL"]), "FAIL");
    assert.equal(compareResults(["PASS", "FAIL"], ["PASS"]), "Flaky");
  });
});
