import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AuthoringIntakeSchema,
  evidenceLevel,
  GeneratedEvalSuiteSchema,
  ProblemSchema,
  UpdateProposalOutputSchema,
} from "./contracts";

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
  it("requires durable, answerable material questions", () => {
    const parsed = AuthoringIntakeSchema.parse({
      understanding: {
        inputs: [],
        outputs: [],
        authorities: [],
        invariants: [],
        allowedChanges: [],
        dependencies: [],
        ambiguity: [],
        likelyHallucinations: [],
        failureModes: [],
      },
      questions: [
        {
          id: "source_of_truth",
          prompt: "Which source is authoritative?",
          whyItMatters: "It determines correctness.",
          required: true,
          answerType: "text",
          choices: [],
        },
      ],
    });
    assert.equal(parsed.questions[0]?.required, true);
  });
  it("rejects unsafe generated case and update paths", () => {
    assert.equal(
      GeneratedEvalSuiteSchema.safeParse({
        cases: [],
        generationNotes: [],
      }).success,
      false,
    );
    assert.equal(
      UpdateProposalOutputSchema.safeParse({
        rootCause: "cause",
        intendedEffect: "effect",
        verification: "verify",
        risks: [],
        skillChanges: [
          {
            path: "../auth.json",
            action: "replace",
            content: "bad",
            reason: "bad",
          },
        ],
        evalChanges: [],
      }).success,
      false,
    );
  });
});
