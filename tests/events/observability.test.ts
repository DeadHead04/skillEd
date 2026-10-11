import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, open } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT_CONTEXT, trace } from "@opentelemetry/api";
import {
  parseResourceAttributes,
  mergeResourceAttributes,
  contextWithAgentAttributes,
  agentAttributesFromContext,
  contextWithSpanAttributes,
  spanAttributesFromContext,
  agentEnv,
  tracingEnabledForEnv,
} from "../../src/observability/index.js";
import * as logging from "../../src/logging/index.js";
import * as ui from "../../src/ui/index.js";
const execute = promisify(execFile);
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of Object.keys(env))
    if (k.startsWith("OTEL_") || k.startsWith("SKILLED_")) delete env[k];
  return env;
}
const driver = new URL("./telemetry-driver.js", import.meta.url).pathname;
test("disabled provider executes actual process with no exporter initialization", async () => {
  const { stdout } = await execute(process.execPath, [driver, "disabled"], {
    env: cleanEnv(),
  });
  assert.match(stdout, /disabled-pass/);
});
test("resource attributes retain precedence and safe delimiter handling", () => {
  assert.deepEqual(parseResourceAttributes("a=one,b=two=3,no, =x,c= "), {
    a: "one",
    b: "two=3",
  });
  assert.equal(
    mergeResourceAttributes("a=base,b=keep", { a: " new,x=1\n", c: "three" }),
    "a=new_x_1,b=keep,c=three",
  );
});
test("context attributes are snapshots and child environment preserves control precedence", () => {
  const attrs = { "app.name": "one" };
  const ctx = contextWithAgentAttributes(
    contextWithSpanAttributes(ROOT_CONTEXT, attrs),
    attrs,
  );
  attrs["app.name"] = "changed";
  const a = agentAttributesFromContext(ctx);
  a["app.name"] = "other";
  assert.equal(agentAttributesFromContext(ctx)["app.name"], "one");
  assert.equal(spanAttributesFromContext(ctx)["app.name"], "one");
  assert.equal(
    tracingEnabledForEnv({
      OTEL_TRACES_EXPORTER: "none",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
    }),
    false,
  );
  const withSpan = trace.setSpanContext(ctx, {
    traceId: "1".repeat(32),
    spanId: "2".repeat(16),
    traceFlags: 1,
  });
  const result = agentEnv(withSpan, {
    OTEL_TRACES_EXPORTER: "otlp",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
    SKILLED_AGENT_OTEL_RESOURCE_ATTRIBUTES: "deployment.name=agent",
    SKILLED_AGENT_OTEL_SPAN_ATTRIBUTES: "context.name=agent",
    OTEL_RESOURCE_ATTRIBUTES: "base.name=kept",
    SECRET_KEY: "must-not-copy",
  });
  assert.equal(result.TRACEPARENT, `00-${"1".repeat(32)}-${"2".repeat(16)}-01`);
  assert.match(result.OTEL_RESOURCE_ATTRIBUTES, /deployment.name=agent/);
  assert.match(result.BAGGAGE, /context.name=agent/);
  assert.equal(result.SECRET_KEY, undefined);
});
test("actual file logging respects verbosity and progress retains visible output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skilled-output-"));
  try {
    const path = join(dir, "output.log"),
      writer = createWriteStream(path);
    const restoreLog = logging.setOutput(writer),
      restoreUI = ui.setOutput(writer);
    try {
      logging.setVerbosity(0);
      logging.debugf("invisible");
      logging.infof("visible %s", "info");
      logging.setVerbosity(2);
      logging.tracef("visible trace");
      logging.warnf("warning");
      ui.step("📋", "Preparing");
      ui.caseStart(1, 2, "case-a", "Alpha");
      ui.caseComplete(1, 2, "case-a", "PASS", 1);
      ui.caseComplete(2, 2, "case-b", "SKIP", -1);
      ui.summary(1, 0, 0);
      ui.separator();
      ui.blank();
    } finally {
      restoreLog();
      restoreUI();
      logging.setVerbosity(0);
      writer.end();
      await finished(writer);
    }
    const content = await readFile(path, "utf8");
    assert.doesNotMatch(content, /invisible/);
    assert.match(content, /level=INFO msg="visible info"/);
    assert.match(content, /level=TRACE/);
    assert.match(content, /level=WARNING/);
    assert.match(content, /✅ \[1\/2\] case-a: PASS \(100.0%\)/);
    assert.match(content, /⏭️ \[2\/2\] case-b: SKIP/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("unsupported protocols and metric exporters fail actual initialization", async () => {
  for (const extra of [
    { OTEL_TRACES_EXPORTER: "otlp", OTEL_EXPORTER_OTLP_PROTOCOL: "invalid" },
    { OTEL_METRICS_EXPORTER: "invalid" },
  ]) {
    await assert.rejects(
      execute(process.execPath, [driver, "export"], {
        env: { ...cleanEnv(), ...extra },
      }),
      /unsupported/,
    );
  }
});
// Live collector is a genuine OpenTelemetry Collector; no intercepted requests or in-memory exporters.
for (const protocol of ["grpc", "http/protobuf"])
  test(
    `real collector receives ${protocol} traces, metrics, context and log events`,
    { skip: !process.env.SKILLED_TEST_OTEL_FILE },
    async () => {
      const runID = `real-${protocol.replace("/", "-")}-${Date.now()}`;
      const endpoint =
        protocol === "grpc"
          ? process.env.SKILLED_TEST_OTEL_GRPC || "http://127.0.0.1:14317"
          : process.env.SKILLED_TEST_OTEL_HTTP || "http://127.0.0.1:14318";
      const { stdout } = await execute(process.execPath, [driver, "export"], {
        env: {
          ...cleanEnv(),
          OTEL_TRACES_EXPORTER: "otlp",
          OTEL_METRICS_EXPORTER: "otlp",
          OTEL_EXPORTER_OTLP_PROTOCOL: protocol,
          OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
          SKILLED_OTEL_RESOURCE_ATTRIBUTES: `test.run=${runID}`,
          SKILLED_OTEL_SPAN_ATTRIBUTES: "deployment.name=phase-one",
          SKILLED_OTEL_LOG_MESSAGE: "false",
        },
      });
      assert.match(stdout, /export-pass/);
      let content = "";
      for (let i = 0; i < 30; i++) {
        content = await readFile(process.env.SKILLED_TEST_OTEL_FILE!, "utf8");
        const own = content
          .split("\n")
          .filter((l) => l.includes(runID))
          .join("\n");
        if (
          own.includes("skilled.runtime.exec.duration") &&
          own.includes("skilled.linked_trace_id") &&
          own.includes("skilled.log")
        )
          break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const lines = content.split("\n").filter((l) => l.includes(runID));
      assert.ok(
        lines.length >= 2,
        "collector persisted both metrics and traces",
      );
      const text = lines.join("\n");
      for (const token of [
        "actual.operation",
        "actual.linked",
        "skilled.linked_trace_id",
        "skilled.run.count",
        "skilled.runtime.exec.duration",
        "test.context",
        "deployment.name",
        "skilled.log",
      ])
        assert.ok(text.includes(token), `missing ${token}`);
      assert.ok(
        !text.includes("Actual telemetry log"),
        "log message suppressed by config",
      );
    },
  );
