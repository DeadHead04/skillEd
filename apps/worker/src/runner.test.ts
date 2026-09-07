import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "@skilled/core";
import { persistSkillUpCaseResult } from "./runner.js";
import {
  buildExecutionSlots,
  createSkillUpProgressParser,
  type ProgressEvent,
} from "./run-progress.js";

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

test("maps a passing script judge to the case dimensions using its canonical path", async () => {
  let inserted: unknown[] = [];
  const fakeSql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = strings.join("?");
    if (statement.startsWith("SELECT * FROM eval_cases"))
      return Promise.resolve([
        {
          assertion_mapping: {},
          judge_type: "script",
          required_dimensions: ["correctness", "stability"],
        },
      ]);
    if (statement.startsWith("INSERT INTO case_results")) inserted = values;
    return Promise.resolve([]);
  }) as unknown as Db;
  fakeSql.json = (value: unknown) => value as never;

  await persistSkillUpCaseResult(
    fakeSql,
    { id: "run-1", eval_version_id: "eval-1" },
    {
      case_id: "I1-FG-01",
      status: "PASS",
      grading: {
        assertion_results: [
          {
            text: "script: /data/work/run-1/skill/evals/fixtures/scripts/i1-fg-01.sh",
            passed: true,
            evidence: '{"passed":true,"checks":9}',
          },
        ],
      },
    },
    1,
  );

  assert.equal(inserted[4], "PASS");
  assert.deepEqual(inserted[6], { correctness: true, stability: true });
});

test("rejects a script result whose filename does not match its case ID", async () => {
  let inserted: unknown[] = [];
  const fakeSql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = strings.join("?");
    if (statement.startsWith("SELECT * FROM eval_cases"))
      return Promise.resolve([
        {
          assertion_mapping: {},
          judge_type: "script",
          required_dimensions: ["correctness"],
        },
      ]);
    if (statement.startsWith("INSERT INTO case_results")) inserted = values;
    return Promise.resolve([]);
  }) as unknown as Db;
  fakeSql.json = (value: unknown) => value as never;

  await persistSkillUpCaseResult(
    fakeSql,
    { id: "run-1", eval_version_id: "eval-1" },
    {
      case_id: "I1-FG-01",
      status: "PASS",
      grading: {
        assertion_results: [
          {
            text: "script: /data/work/run-1/skill/evals/fixtures/scripts/i1-fg-02.sh",
            passed: true,
          },
        ],
      },
    },
    1,
  );

  assert.equal(inserted[4], "ERROR");
});

test("parses explicit Skill-Up configurations across split, out-of-order lines", async () => {
  const events: ProgressEvent[] = [];
  const parser = createSkillUpProgressParser({
    slots: buildExecutionSlots(["global-checkout-outage"], true),
    iterations: 1,
    onEvent: async (event) => {
      events.push(event);
    },
  });
  parser.feed(
    "warning: retry policy loaded\n ⏳ [2/2] [WITHOUT-SKILL] global-check",
  );
  parser.feed(
    "out-outage: Checkout remains available...\n❌ [2/2] global-checkout-outage: FAIL (50.0%)\n",
  );
  parser.feed("✅ [1/2] [WITH-SKILL] global-checkout-outage: PASS (100.0%)");
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

test("advances iterations only after every expected execution completes", async () => {
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

test("uses the reported case and configuration when execution order differs", async () => {
  const events: ProgressEvent[] = [];
  const parser = createSkillUpProgressParser({
    slots: buildExecutionSlots(["AOJ-01", "SFG-01"], false),
    iterations: 2,
    onEvent: async (event) => {
      events.push(event);
    },
  });
  parser.feed(
    "⏳ [1/2] [WITH-SKILL] SFG-01: Scope fidelity...\n" +
      "❌ [1/2] [WITH-SKILL] SFG-01: FAIL (50.0%)\n" +
      "✅ [2/2] [WITH-SKILL] AOJ-01: PASS (100.0%)\n" +
      "⏳ [1/2] [WITH-SKILL] SFG-01: Scope fidelity...\n",
  );
  await parser.drain();

  assert.deepEqual(
    events.map(({ data }) => ({
      caseId: data.caseId,
      configuration: data.configuration,
      iteration: data.iteration,
    })),
    [
      { caseId: "SFG-01", configuration: "with_skill", iteration: 1 },
      { caseId: "SFG-01", configuration: "with_skill", iteration: 1 },
      { caseId: "AOJ-01", configuration: "with_skill", iteration: 1 },
      { caseId: "SFG-01", configuration: "with_skill", iteration: 2 },
    ],
  );
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
  parser.feed(
    "⏳ [1/1] [WITHOUT-SKILL] case-a: Case A...\n❌ [2/2] unexpected: ERROR\n",
  );
  await Promise.resolve();
  assert.deepEqual(order, ["start-1"]);
  releaseFirst();
  await parser.drain();
  assert.deepEqual(order, ["start-1", "end-1", "start-2", "end-2"]);
  assert.deepEqual(configurations, ["unknown", "unknown"]);
});
