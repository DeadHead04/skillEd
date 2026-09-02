import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evidenceLevel, ProblemSchema } from "./contracts";

describe("shared contracts", () => {
  it("derives deterministic evidence levels", () => {
    assert.equal(evidenceLevel([]), "Provisional");
    assert.equal(evidenceLevel(["task"]), "Behavioral");
    assert.equal(evidenceLevel(["authority"]), "Grounded");
    assert.equal(evidenceLevel(["authority", "dataset"]), "Strong");
  });
  it("requires a safe problem envelope", () => {
    assert.equal(
      ProblemSchema.safeParse({
        code: "BAD",
        title: "Bad",
        detail: "No",
        retryable: false,
        correlationId: "abc",
      }).success,
      true,
    );
  });
});
