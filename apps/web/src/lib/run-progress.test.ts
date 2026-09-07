import assert from "node:assert/strict";
import test from "node:test";
import { reconstructRunStatus, runConfigurationLabel } from "./run-progress.js";

test("presents every Skill-Up configuration explicitly", () => {
  assert.equal(runConfigurationLabel("with_skill"), "With Skill");
  assert.equal(runConfigurationLabel("without_skill"), "Without Skill");
  assert.equal(runConfigurationLabel("unknown"), "Unknown configuration");
});

test("reconstructs pending, active, and completed executions for one run", () => {
  const snapshot = reconstructRunStatus(
    {
      id: "run-a",
      status: "running",
      baseline: true,
      iterations: 1,
      created_at: "2026-09-03T12:00:00Z",
    },
    ["case-a", "case-b"],
    [
      {
        sequence: 1,
        type: "stage_changed",
        data: { stage: "running" },
        occurred_at: "2026-09-03T12:01:00Z",
      },
      {
        sequence: 2,
        type: "case_completed",
        data: {
          caseId: "case-a",
          configuration: "with_skill",
          iteration: 1,
          reportedStatus: "PASS",
        },
        occurred_at: "2026-09-03T12:02:00Z",
      },
      {
        sequence: 3,
        type: "case_started",
        data: {
          caseId: "case-b",
          configuration: "without_skill",
          iteration: 1,
        },
        occurred_at: "2026-09-03T12:03:00Z",
      },
    ],
  );
  assert.equal(snapshot.runId, "run-a");
  assert.equal(snapshot.completed, 1);
  assert.equal(snapshot.total, 4);
  assert.equal(
    snapshot.executions.filter((item) => item.state === "active").length,
    1,
  );
  assert.equal(
    snapshot.executions.filter((item) => item.state === "pending").length,
    2,
  );
  assert.equal(snapshot.updatedAt, "2026-09-03T12:03:00.000Z");
  assert.equal("detail" in snapshot, false);
});

test("authoritative results replace provisional statuses at terminal state", () => {
  const snapshot = reconstructRunStatus(
    {
      id: "run-b",
      status: "completed",
      baseline: false,
      iterations: 1,
      created_at: "2026-09-03T12:00:00Z",
      completed_at: "2026-09-03T12:05:00Z",
    },
    ["case-a"],
    [
      {
        sequence: 1,
        type: "case_completed",
        data: {
          caseId: "case-a",
          configuration: "with_skill",
          iteration: 1,
          reportedStatus: "FAIL",
        },
        occurred_at: "2026-09-03T12:04:00Z",
      },
    ],
    [
      {
        case_id: "case-a",
        configuration: "with_skill",
        iteration: 1,
        result: "PARTIAL",
      },
    ],
  );
  assert.equal(snapshot.stage, "completed");
  assert.deepEqual(snapshot.executions[0], {
    caseId: "case-a",
    configuration: "with_skill",
    iteration: 1,
    state: "completed",
    result: "PARTIAL",
    provisional: false,
  });
});
