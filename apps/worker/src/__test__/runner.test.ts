import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "@skilled/core";
import { persistSkillUpCaseResult } from "../runner.js";
import {
  buildExecutionSlots,
  createSkillUpProgressParser,
  type ProgressEvent,
} from "../run-progress.js";

test("persists a normalized Skill-Up case result with valid INSERT SQL", async () => {
  const statements: string[] = [];
  const fakeSql = ((strings: TemplateStringsArray) => {
    const statement = strings.join("?");
    statements.push(statement);
    if (statement.startsWith("SELECT * FROM eval_cases"))
      return Promise.resolve([
        {
          assertion_mapping: {
            "Returns grounded evidence": {
              dimension: "correctness",
              required: true,
            },
          },
          judge_type: "agent",
          required_dimensions: ["correctness"],
        },
      ]);
    return Promise.resolve([]);
  }) as unknown as Db;
  fakeSql.json = (value: unknown) => value as never;

  await persistSkillUpCaseResult(
    fakeSql,
    { id: "run-1", eval_version_id: "eval-1" },
    {
      case_id: "CASE-1",
      status: "PASS",
      grading: {
        assertion_results: [
          {
            text: "Returns grounded evidence",
            passed: true,
            evidence: "Grounded output",
          },
        ],
      },
    },
    1,
  );

  assert.equal(statements.length, 2);
  assert.match(statements[1]!, /^INSERT INTO case_results/);
  assert.match(statements[1]!, /VALUES\(.*\)$/);
});

test("parses split lines, ignores noise, and maps out-of-order baseline slots", async () => {
  const events: ProgressEvent[] = [];
  const parser = createSkillUpProgressParser({
    slots: buildExecutionSlots(["global-checkout-outage"], true),
    iterations: 1,
    onEvent: async (event) => {
      events.push(event);
    },
  });
  parser.feed("warning: retry policy loaded\n ⏳ [2/2] global-check");
  parser.feed(
    "out-outage: Checkout remains available...\n❌ [2/2] global-checkout-outage: FAIL (50.0%)\n",
  );
  parser.feed("✅ [1/2] global-checkout-outage: PASS (100.0%)");
  parser.flush();
  await parser.drain();

  assert.deepEqual(events, [
    {
      type: "case_started",
      data: {
        caseId: "global-checkout-outage",
        index: 2,
        total: 2,
        configuration: "without_skill",
        iteration: 1,
        provisional: true,
      },
    },
    {
      type: "case_completed",
      data: {
        caseId: "global-checkout-outage",
        index: 2,
        total: 2,
        configuration: "without_skill",
        iteration: 1,
        provisional: true,
        reportedStatus: "FAIL",
      },
    },
    {
      type: "case_completed",
      data: {
        caseId: "global-checkout-outage",
        index: 1,
        total: 2,
        configuration: "with_skill",
        iteration: 1,
        provisional: true,
        reportedStatus: "PASS",
      },
    },
  ]);
});

test("advances iterations only after every expected index completes", async () => {
  const events: ProgressEvent[] = [];
  const parser = createSkillUpProgressParser({
    slots: buildExecutionSlots(["case-a", "case-b"], false),
    iterations: 2,
    onEvent: async (event) => {
      events.push(event);
    },
  });
  parser.feed(
    "✅ [2/2] case-b: PASS\n✅ [1/2] case-a: PASS\n⏳ [1/2] case-a: ...\n",
  );
  await parser.drain();
  assert.equal(events[0]!.data.iteration, 1);
  assert.equal(events[1]!.data.iteration, 1);
  assert.equal(events[2]!.data.iteration, 2);
});

test("serializes writes, drains them, and marks contradictory output unknown", async () => {
  const order: string[] = [];
  const configurations: string[] = [];
  let releaseFirst!: () => void;
  const firstWrite = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const parser = createSkillUpProgressParser({
    slots: buildExecutionSlots(["case-a"], false),
    iterations: 1,
    onEvent: async (event) => {
      configurations.push(event.data.configuration);
      order.push(`start-${event.data.index}`);
      if (event.data.index === 1) await firstWrite;
      order.push(`end-${event.data.index}`);
    },
  });
  parser.feed("⏳ [1/2] unexpected: ...\n❌ [2/2] unexpected: ERROR\n");
  await Promise.resolve();
  assert.deepEqual(order, ["start-1"]);
  releaseFirst();
  await parser.drain();
  assert.deepEqual(order, ["start-1", "end-1", "start-2", "end-2"]);
  assert.deepEqual(configurations, ["unknown", "unknown"]);
});
