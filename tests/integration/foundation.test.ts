import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Loader,
  validateEvalConfig,
  validateCaseConfig,
  toRuntimeConfig,
} from "../../src/config/index.js";
import { createRuntime, type RuntimeConfig } from "../../src/runtime/index.js";
import {
  JSONLSink,
  Publisher,
  Lifecycle,
  type Event,
} from "../../src/events/index.js";
import { init } from "../../src/observability/index.js";

const runID = `foundation-${Date.now()}`;
if (process.env.SKILLED_TEST_OTEL_FILE) {
  process.env.OTEL_TRACES_EXPORTER = "otlp";
  process.env.OTEL_METRICS_EXPORTER = "otlp";
  process.env.OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf";
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
    process.env.SKILLED_TEST_OTEL_HTTP || "http://127.0.0.1:14318";
  process.env.SKILLED_OTEL_RESOURCE_ATTRIBUTES = `test.run=${runID}`;
}
const telemetry = await init("0.1.0-dev.0");
after(async () => {
  await telemetry.shutdown();
  if (process.env.SKILLED_TEST_OTEL_FILE) {
    let own = "";
    for (let attempt = 0; attempt < 30; attempt++) {
      own = (await readFile(process.env.SKILLED_TEST_OTEL_FILE, "utf8"))
        .split("\n")
        .filter((line) => line.includes(runID))
        .join("\n");
      if (
        own.includes("runtime.exec") &&
        own.includes("skilled.runtime.exec.duration")
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(
      own.includes("runtime.exec"),
      "actual runtime span reached collector",
    );
    assert.ok(
      own.includes("skilled.runtime.exec.duration"),
      "actual runtime metric reached collector",
    );
  }
});

for (const type of ["none", "docker", "opensandbox"] as const) {
  const enabled =
    type === "none" ||
    (type === "docker"
      ? process.env.SKILLED_DOCKER_INTEGRATION === "1"
      : process.env.SKILLED_REAL_OPENSANDBOX === "1");
  test(
    `integrated ${type}: YAML → runtime → real artifact → terminal JSONL → collector`,
    { skip: !enabled && "live service not enabled", timeout: 180000 },
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), "skilled-integrated-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      await mkdir(join(root, "evals", "cases"), { recursive: true });
      await writeFile(
        join(root, "SKILL.md"),
        "---\nname: skilled-improve\n---\nPhase 1 runtime integration\n",
      );
      const environment = {
        type,
        image:
          type === "opensandbox"
            ? process.env.SKILLED_REAL_OPENSANDBOX_IMAGE || "alpine:3.20"
            : "alpine:3.20",
        env: { MESSAGE: "from-config" },
        use_server_proxy: process.env.SKILLED_REAL_OPENSANDBOX_PROXY === "1",
        ready_timeout_seconds: 90,
        sandbox_timeout_seconds: 300,
        kwargs:
          type === "opensandbox"
            ? {
                base_url: process.env.SKILLED_REAL_OPENSANDBOX_BASE_URL || "",
                request_timeout_seconds: "60",
              }
            : {},
      };
      await writeFile(
        join(root, "evals", "eval.yaml"),
        JSON.stringify({
          schema_version: "v1alpha1",
          environment,
          engine: { name: "claude_code" },
          cases: { files: ["evals/cases/real.yaml"] },
          report: { formats: ["json"] },
        }),
      );
      await writeFile(
        join(root, "evals", "cases", "real.yaml"),
        "id: real\ntitle: Real runtime artifact\ninput:\n  prompt: Run the transferred shell script\n",
      );
      const loader = await Loader.create(join(root, "evals", "eval.yaml"));
      const { eval: evaluation, cases } = await loader.loadAll();
      validateEvalConfig(evaluation);
      validateCaseConfig(cases[0]);
      assert.equal(await loader.skillName(), "skilled-improve");
      const runtime = createRuntime(
        toRuntimeConfig(evaluation.environment) as RuntimeConfig,
      );
      t.after(() => runtime.close());
      await runtime.create();
      await runtime.start();
      runtime.mergeEnv({ MESSAGE: "from-merge" });
      const script = join(root, "helper");
      await writeFile(
        script,
        '#!/bin/sh\nprintf "%s" "$MESSAGE" > result.txt\nprintf completed\n',
        { mode: 0o755 },
      );
      await runtime.uploadFile(script, "helper");
      const eventFile = join(root, "events.jsonl");
      const publisher = new Publisher(await JSONLSink.open(eventFile));
      t.after(() => publisher.close());
      const lifecycle = new Lifecycle(publisher, {
        iterations: [
          {
            number: 1,
            tasks: [
              {
                id: "task",
                iteration: 1,
                caseID: cases[0].id,
                configuration: "with_skill",
                index: 1,
                title: cases[0].title,
              },
            ],
          },
        ],
      });
      await lifecycle.start(evaluation.engine.name, "phase1");
      await lifecycle.setPhase("executing");
      await lifecycle.iterationStarted(1);
      await lifecycle.caseStarted("task");
      const result = await runtime.exec("./helper", {
        env: { MESSAGE: "from-exec" },
        timeoutMs: 10000,
        context: telemetry.context,
      });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "completed");
      await runtime.downloadFile("result.txt", join(root, "download.txt"));
      assert.equal(
        await readFile(join(root, "download.txt"), "utf8"),
        "from-exec",
      );
      await lifecycle.caseCompleted("task", "PASS", 1);
      await lifecycle.iterationCompleted(1);
      await lifecycle.finish("COMPLETED");
      await publisher.close();
      const events: Event[] = (await readFile(eventFile, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(events.filter((event) => event.last_event).length, 1);
      assert.equal(events.at(-1)?.event, "run_finished");
      assert.equal((events.at(-1)?.payload as { passed: number }).passed, 1);
      assert.deepEqual(
        events.map((event) => event.sequence_number),
        events.map((_, index) => index + 1),
      );
      await runtime.close();
    },
  );
}
