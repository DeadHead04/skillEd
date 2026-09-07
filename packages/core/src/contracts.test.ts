import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import {
  AuthoringIntakeSchema,
  canonicalScriptJudgePath,
  canonicalSkillChangePath,
  evidenceLevel,
  GeneratedEvalCaseSchema,
  GeneratedEvalSuiteSchema,
  matchesCanonicalScriptJudgePath,
  SCRIPT_JUDGE_BASE_PATH,
  CreateUserSchema,
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
  it("exposes the uppercase generated case ID contract to structured output", () => {
    const jsonSchema = z.toJSONSchema(GeneratedEvalCaseSchema) as {
      properties?: { id?: { pattern?: string } };
    };

    assert.equal(jsonSchema.properties?.id?.pattern, "^[A-Z][A-Z0-9_-]{2,63}$");
    assert.equal(
      GeneratedEvalCaseSchema.shape.id.safeParse("grounded-commercial-math")
        .success,
      false,
    );
    assert.equal(
      GeneratedEvalCaseSchema.shape.id.safeParse("GROUNDED-COMMERCIAL-MATH")
        .success,
      true,
    );
  });
  it("canonicalizes generated Skill paths relative to the selected root", () => {
    assert.equal(
      canonicalSkillChangePath(
        "base-skill/incident-postmortem-narrator/SKILL.md",
        "incident-postmortem-narrator",
      ),
      "SKILL.md",
    );
    assert.equal(
      canonicalSkillChangePath(
        "incident-postmortem-narrator/references/checklist.md",
        "incident-postmortem-narrator",
      ),
      "references/checklist.md",
    );
    assert.equal(
      canonicalSkillChangePath("references/checklist.md", "skill"),
      "references/checklist.md",
    );
    assert.throws(() => canonicalSkillChangePath("../auth.json", "skill"));
  });
  it("derives and validates canonical script judge paths from case IDs", () => {
    assert.equal(
      canonicalScriptJudgePath(SCRIPT_JUDGE_BASE_PATH, "I1-FG-01"),
      "evals/fixtures/scripts/i1-fg-01.sh",
    );
    assert.equal(
      matchesCanonicalScriptJudgePath(
        "script: /data/work/run-1/skill/evals/fixtures/scripts/i1-fg-01.sh",
        SCRIPT_JUDGE_BASE_PATH,
        "I1-FG-01",
      ),
      true,
    );
    assert.equal(
      matchesCanonicalScriptJudgePath(
        "script: /data/work/run-1/skill/evals/fixtures/scripts/i1-fg-02.sh",
        SCRIPT_JUDGE_BASE_PATH,
        "I1-FG-01",
      ),
      false,
    );
    assert.throws(() => canonicalScriptJudgePath("../scripts", "I1-FG-01"));
  });
  it("normalizes safe login IDs and rejects weak account data", () => {
    assert.equal(
      CreateUserSchema.parse({
        loginId: "  QC.Operator  ",
        displayName: "QC Operator",
        role: "operator",
        password: "twelve-chars-minimum",
      }).loginId,
      "qc.operator",
    );
    assert.equal(
      CreateUserSchema.safeParse({
        loginId: "bad login",
        displayName: "Bad",
        role: "owner",
        password: "short",
      }).success,
      false,
    );
  });
});
