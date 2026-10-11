import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  JSONLSink,
  Publisher,
  Lifecycle,
  validatePlan,
  validatePayload,
  validateUserAttributes,
  type Event,
  type Plan,
} from "../../src/events/index.js";
const plan: Plan = {
  iterations: [
    {
      number: 1,
      tasks: [
        {
          id: "a",
          iteration: 1,
          caseID: "case-a",
          configuration: "with_skill",
          index: 1,
          title: "Alpha",
        },
        {
          id: "b",
          iteration: 1,
          caseID: "case-b",
          configuration: "without_skill",
          index: 2,
          title: "Beta",
        },
      ],
    },
  ],
};
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "skilled-events-"));
  const path = join(dir, "events.jsonl");
  const sink = await JSONLSink.open(path);
  const publisher = new Publisher(sink, {
    attributes: { "test.name": "real-file" },
  });
  return {
    dir,
    path,
    publisher,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
async function records(path: string): Promise<Event[]> {
  return (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((s) => JSON.parse(s));
}
test("actual file lifecycle orders concurrent tasks, snapshots counts and drains before closing", async () => {
  const s = await setup();
  try {
    const l = new Lifecycle(s.publisher, plan);
    await l.start("custom", "sample");
    await l.setPhase("executing");
    await l.iterationStarted(1);
    await Promise.all([l.caseStarted("a"), l.caseStarted("b")]);
    await Promise.all([
      l.caseCompleted("b", "FAIL", 0),
      l.caseCompleted("a", "PASS", 1),
    ]);
    await l.iterationCompleted(1);
    await l.finish("COMPLETED");
    await s.publisher.close();
    await s.publisher.close();
    const events = await records(s.path);
    assert.deepEqual(
      events.map((e) => e.event),
      [
        "run_started",
        "run_progress",
        "run_progress",
        "iteration_started",
        "case_started",
        "run_progress",
        "case_started",
        "run_progress",
        "case_completed",
        "run_progress",
        "case_completed",
        "run_progress",
        "iteration_completed",
        "run_progress",
        "run_finished",
      ],
    );
    assert.deepEqual(
      events.map((e) => e.sequence_number),
      events.map((_, i) => i + 1),
    );
    assert.equal(new Set(events.map((e) => e.invocation_id)).size, 1);
    assert.equal(events.filter((e) => e.last_event).length, 1);
    assert.deepEqual(events.at(-1)?.payload, {
      passed: 1,
      failed: 1,
      errored: 0,
      skipped: 0,
      status: "COMPLETED",
      completed_tasks: 2,
      duration_ms: (events.at(-1)!.payload as { duration_ms: number })
        .duration_ms,
    });
    assert.equal((await stat(s.path)).mode & 0o777, 0o600);
    await assert.rejects(l.caseStarted("a"), /finished/);
  } finally {
    await s.cleanup();
  }
});
test("real clock emits heartbeats and cancellation stops further records", async () => {
  const s = await setup();
  try {
    const l = new Lifecycle(s.publisher, plan, { heartbeatIntervalMs: 10 });
    await l.start("custom", "sample");
    await delay(35);
    await l.finish("CANCELLED");
    await s.publisher.close();
    const events = await records(s.path);
    assert.ok(events.filter((e) => e.event === "run_progress").length >= 3);
    const length = (await readFile(s.path)).length;
    await delay(25);
    assert.equal((await readFile(s.path)).length, length);
    assert.equal(
      (events.at(-1)!.payload as { status: string }).status,
      "CANCELLED",
    );
  } finally {
    await s.cleanup();
  }
});
test("all terminal outcomes including execution errors and skips reach proper result counts", async () => {
  const s = await setup();
  try {
    const l = new Lifecycle(s.publisher, plan);
    await l.start("custom", "sample");
    await l.setPhase("executing");
    await l.iterationStarted(1);
    await l.caseStarted("a");
    await l.caseCompleted("a", "ERROR");
    await l.caseStarted("b");
    await l.caseCompleted("b", "SKIP");
    await l.iterationCompleted(1);
    await l.finish("COMPLETED");
    await s.publisher.close();
    const p = (await records(s.path)).at(-1)!.payload;
    assert.equal((p as { errored: number }).errored, 1);
    assert.equal((p as { skipped: number }).skipped, 1);
  } finally {
    await s.cleanup();
  }
});
test("invalid state transitions do not mutate lifecycle", async () => {
  const s = await setup();
  try {
    const l = new Lifecycle(s.publisher, plan);
    await assert.rejects(l.heartbeat(), /not started/);
    await l.start("custom", "sample");
    await assert.rejects(l.start("custom", "sample"), /already started/);
    await assert.rejects(l.caseStarted("a"), /not executing/);
    await assert.rejects(l.setPhase("preparing"), /not forward/);
    await assert.rejects(l.setPhase("finalizing"), /owned by Finish/);
    await l.setPhase("executing");
    await assert.rejects(l.caseStarted("a"), /not active/);
    await assert.rejects(l.iterationStarted(2), /unknown iteration/);
    await l.iterationStarted(1);
    await assert.rejects(l.iterationStarted(1), /already started/);
    await assert.rejects(l.iterationCompleted(1), /unfinished/);
    await assert.rejects(l.caseCompleted("a", "PASS"), /not actively/);
    await l.caseStarted("a");
    await assert.rejects(l.caseStarted("a"), /already started/);
    await assert.rejects(l.caseCompleted("a", "PASS", Infinity), /pass_rate/);
    await l.caseCompleted("a", "PASS", 1);
    await assert.rejects(l.caseCompleted("a", "PASS"), /not actively/);
    await assert.rejects(l.finish("COMPLETED"), /terminal tasks/);
    await l.finish("ERROR");
    await s.publisher.close();
  } finally {
    await s.cleanup();
  }
});
test("immutable plan rejects missing, duplicate, malformed tasks and indices", () => {
  assert.throws(() => validatePlan({ iterations: [] }));
  const variants: Plan[] = [
    { iterations: [{ number: 1, tasks: [] }] },
    structuredClone(plan),
    structuredClone(plan),
    structuredClone(plan),
    structuredClone(plan),
  ];
  variants[1].iterations[0].tasks[1].id = "a";
  variants[2].iterations[0].tasks[1].index = 1;
  variants[3].iterations[0].tasks[0].iteration = 2;
  variants[4].iterations[0].tasks[0].title = "\uD800";
  for (const p of variants) assert.throws(() => validatePlan(p));
  assert.doesNotThrow(() => validatePlan(plan));
});
test("real publisher snapshots payloads, rejects post-final publishing and surfaces closed-file errors", async () => {
  const s = await setup();
  try {
    const payload = { iteration: 1 };
    const pending = s.publisher.publish("iteration_started", payload);
    payload.iteration = 999;
    await pending;
    await s.publisher.publishLast("iteration_started", { iteration: 2 });
    await assert.rejects(
      s.publisher.publish("iteration_started", { iteration: 3 }),
      /last event/,
    );
    await s.publisher.close();
    assert.equal(
      ((await records(s.path))[0].payload as { iteration: number }).iteration,
      1,
    );
    const file = await open(join(s.dir, "closed"), "w");
    const sink = new JSONLSink(file);
    await file.close();
    const p = new Publisher(sink);
    await assert.rejects(p.publish("iteration_started", { iteration: 1 }));
    assert.ok(p.err());
    await assert.rejects(p.publish("iteration_started", { iteration: 2 }));
    await assert.rejects(p.close());
  } finally {
    await s.cleanup();
  }
});
test("aborted writes, maximum event size and real file truncation", async () => {
  const s = await setup();
  try {
    const cancelled = AbortSignal.abort();
    await assert.rejects(
      s.publisher.publish("iteration_started", { iteration: 1 }, cancelled),
    );
    await assert.rejects(s.publisher.close());
    assert.equal((await readFile(s.path)).length, 0);
    const p = new Publisher(await JSONLSink.open(s.path));
    await assert.rejects(
      p.publish("run_started", {
        engine: "a".repeat(1 << 20),
        skill_name: "x",
        task_total: 1,
        iterations_total: 1,
      }),
      /1048576/,
    );
    await assert.rejects(p.close());
  } finally {
    await s.cleanup();
  }
});
test("payload contracts validate bounds, UTF-8, counts, statuses and rates", () => {
  assert.throws(() =>
    validatePayload("run_started", {
      engine: "",
      skill_name: "x",
      task_total: 1,
      iterations_total: 1,
    }),
  );
  assert.throws(() =>
    validatePayload("iteration_started", { iteration: 2 ** 53 }),
  );
  assert.throws(() => validatePayload("iteration_started", { iteration: -1 }));
  assert.throws(() => validatePayload("iteration_started", { iteration: 1.5 }));
  assert.throws(() =>
    validatePayload("run_finished", {
      status: "COMPLETED",
      completed_tasks: 1,
      passed: 0,
      failed: 0,
      errored: 0,
      skipped: 0,
      duration_ms: 0,
    }),
  );
  assert.throws(() =>
    validatePayload("run_progress", {
      phase: "executing",
      task_total: 1,
      completed_tasks: 0,
      running_tasks: 2,
      elapsed_ms: 0,
      passed: 0,
      failed: 0,
      errored: 0,
      skipped: 0,
    }),
  );
  assert.throws(() =>
    validatePayload("run_finished", {
      status: "COMPLETED",
      completed_tasks: Number.MAX_SAFE_INTEGER,
      passed: Number.MAX_SAFE_INTEGER,
      failed: 1,
      errored: 0,
      skipped: 0,
      duration_ms: 0,
    }),
  );
});
test("attribute contracts enforce namespace, byte budget, dotted keys and UTF-8", () => {
  assert.doesNotThrow(() => validateUserAttributes({ "app.name": "test" }));
  for (const attrs of [
    { "skilled.name": "x" },
    { name: "x" },
    { "app.name": "" },
    { "app.name": "\uD800" },
    { "app.name": "é".repeat(513) },
    Object.fromEntries(
      Array.from({ length: 33 }, (_, i) => [`app.k${i}`, "x"]),
    ),
    Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`app.k${i}`, "x".repeat(1024)]),
    ),
  ])
    assert.throws(() => validateUserAttributes(attrs));
});
