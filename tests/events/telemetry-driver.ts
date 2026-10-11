import { ROOT_CONTEXT } from "@opentelemetry/api";
import {
  init,
  tracer,
  startLinkedRootSpan,
  contextWithSpanAttributes,
  contextWithAgentAttributes,
  recordRunStarted,
  recordCaseCompleted,
  recordRuntimeExec,
  agentEnv,
  tracingEnabled,
} from "../../src/observability/index.js";
import { infoContextf } from "../../src/logging/index.js";
const mode = process.argv[2] || "disabled";
const initialized = await init("1.0.0-test");
if (mode === "disabled") {
  if (tracingEnabled()) throw new Error("tracing unexpectedly enabled");
  if (Reflect.ownKeys(agentEnv(ROOT_CONTEXT)).length)
    throw new Error("unexpected child telemetry");
  await initialized.shutdown();
  console.log("disabled-pass");
} else {
  const ctx = contextWithAgentAttributes(
    contextWithSpanAttributes(initialized.context, {
      "test.context": "present",
    }),
    { "skilled.case.id": "case-one" },
  );
  const operation = tracer().startSpan("actual.operation", {}, ctx);
  operation.end();
  const linked = startLinkedRootSpan(ctx, "actual.linked");
  linked.span.end();
  recordRunStarted(ctx, "custom", "real", 2);
  recordCaseCompleted(ctx, "custom", "PASS", 10);
  recordRuntimeExec(ctx, 0, 20);
  infoContextf(ctx, "Actual telemetry log");
  const child = agentEnv(ctx, {}, { "skilled.engine": "custom" });
  if (
    !child.TRACEPARENT ||
    !child.OTEL_RESOURCE_ATTRIBUTES?.includes("skilled.case.id=case-one")
  )
    throw new Error("child correlation missing");
  await initialized.shutdown();
  console.log("export-pass");
}
