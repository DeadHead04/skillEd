import assert from "node:assert/strict";
import { test } from "node:test";
import { eligibleProposalTargetIds } from "../proposals.js";

test("proposal targets exclude synthetic grading-ingestion assertions", () => {
  assert.deepEqual(
    eligibleProposalTargetIds([
      {
        assertions: [
          {
            id: "ingestion-error",
            required: true,
            passed: false,
            error: "Required dimension has no assertion definition",
          },
        ],
      },
      {
        assertions: [
          { id: "normal_format_001", required: true, passed: false },
          { id: "informational_note", required: false, passed: false },
          { id: "passing", required: true, passed: true },
        ],
      },
    ]),
    ["normal_format_001"],
  );
});
