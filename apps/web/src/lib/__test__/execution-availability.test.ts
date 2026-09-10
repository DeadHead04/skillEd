import test from "node:test";
import assert from "node:assert/strict";
import { executionAvailability } from "../execution-availability";
test("fresh matching mode is required; stale success and stale errors never imply current readiness", () => {
  const now = Date.now();
  const worker = {
    last_seen_at: new Date(now),
    readiness: { execution: "ready" },
  };
  assert.equal(executionAvailability(worker, "real", now).available, true);
  assert.equal(
    executionAvailability(worker, "fake", now).code,
    "ADAPTER_MISMATCH",
  );
  assert.equal(
    executionAvailability(
      { ...worker, readiness: { execution: "demo" } },
      "real",
      now,
    ).available,
    false,
  );
  assert.equal(
    executionAvailability(undefined, "real", now).code,
    "WORKER_UNAVAILABLE",
  );
  assert.equal(
    executionAvailability(worker, "real", now + 30_000).available,
    false,
  );
  assert.equal(
    executionAvailability({ last_seen_at: "invalid" }, "real", now).available,
    false,
  );
  const blocked = {
    ...worker,
    readiness: {
      execution: "blocked",
      code: "ACCEPTANCE_EXPIRED",
      detail: "Acceptance expired",
    },
  };
  assert.equal(
    executionAvailability(blocked, "real", now).code,
    "ACCEPTANCE_EXPIRED",
  );
  assert.equal(
    executionAvailability(blocked, "real", now + 30_000).code,
    "WORKER_UNAVAILABLE",
  );
});
