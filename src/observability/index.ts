// Modified for the skilled TypeScript distribution.
import {
  context,
  trace,
  metrics,
  propagation,
  ROOT_CONTEXT,
  createContextKey,
  type Context,
  type Span,
  type Attributes,
} from "@opentelemetry/api";
import {
  W3CTraceContextPropagator,
  W3CBaggagePropagator,
  CompositePropagator,
} from "@opentelemetry/core";
import {
  resourceFromAttributes,
  defaultResource,
} from "@opentelemetry/resources";
import {
  NodeTracerProvider,
  BatchSpanProcessor,
  type SpanProcessor,
  type ReadableSpan,
  type Span as SDKSpan,
} from "@opentelemetry/sdk-trace-node";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  ConsoleMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { OTLPTraceExporter as GrpcTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { OTLPTraceExporter as HttpTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OTLPMetricExporter as GrpcMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { OTLPMetricExporter as HttpMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
export type Environment = Record<string, string | undefined>;
export type StringAttributes = Record<string, string>;
const spanKey = createContextKey("skilled.span.attributes"),
  agentKey = createContextKey("skilled.agent.attributes");
const propagator = new CompositePropagator({
  propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
});
let cached: { tracing: boolean; metrics: boolean; linked: boolean } | undefined;
const first = (...values: (string | undefined)[]): string =>
  values.find((v) => v?.trim()) || "";
export function parseResourceAttributes(raw: string): StringAttributes {
  const result: StringAttributes = {};
  for (const part of raw.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim(),
      value = part.slice(i + 1).trim();
    if (key && value)
      Object.defineProperty(result, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
  }
  return result;
}
const sanitize = (value: string) => value.trim().replace(/[,=\n\r]/g, "_");
export function mergeResourceAttributes(
  base: string,
  ...maps: StringAttributes[]
): string {
  const merged = parseResourceAttributes(base);
  for (const map of maps)
    for (const [k, v] of Object.entries(map)) {
      const value = sanitize(v);
      if (k.trim() && value)
        Object.defineProperty(merged, k.trim(), {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
    }
  return Object.keys(merged)
    .sort()
    .map((k) => `${k}=${merged[k]}`)
    .join(",");
}
function cleanAttributes(attrs: StringAttributes): StringAttributes {
  const result: StringAttributes = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k.trim() && sanitize(v)) result[k.trim()] = sanitize(v);
  }
  return result;
}
export function contextWithSpanAttributes(
  ctx: Context,
  attrs: StringAttributes,
): Context {
  return Object.keys(attrs).length
    ? ctx.setValue(spanKey, { ...spanAttributesFromContext(ctx), ...attrs })
    : ctx;
}
export function spanAttributesFromContext(ctx: Context): StringAttributes {
  return { ...(ctx.getValue(spanKey) as StringAttributes | undefined) };
}
export function contextWithAgentAttributes(
  ctx: Context,
  attrs: StringAttributes,
): Context {
  return Object.keys(attrs).length
    ? ctx.setValue(agentKey, { ...agentAttributesFromContext(ctx), ...attrs })
    : ctx;
}
export function agentAttributesFromContext(ctx: Context): StringAttributes {
  return { ...(ctx.getValue(agentKey) as StringAttributes | undefined) };
}
const configuredAgentSpanAttributes = (env: Environment): StringAttributes =>
  parseResourceAttributes(
    first(
      env.SKILLED_AGENT_OTEL_SPAN_ATTRIBUTES,
      process.env.SKILLED_AGENT_OTEL_SPAN_ATTRIBUTES,
    ),
  );
export const contextWithConfiguredAgentSpanAttributes = (
  ctx: Context,
  env: Environment,
): Context =>
  contextWithSpanAttributes(ctx, configuredAgentSpanAttributes(env));
export function tracingEnabledForEnv(env: Environment = {}): boolean {
  const exp = first(env.OTEL_TRACES_EXPORTER, process.env.OTEL_TRACES_EXPORTER)
    .trim()
    .toLowerCase();
  if (exp === "none") return false;
  if (exp === "otlp") return true;
  return !!first(
    env.OTEL_EXPORTER_OTLP_ENDPOINT,
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
  );
}
export const tracingEnabled = (): boolean =>
  cached?.tracing ?? tracingEnabledForEnv();
export const metricsEnabled = (): boolean =>
  cached?.metrics ??
  !!(
    process.env.OTEL_METRICS_EXPORTER?.trim() &&
    process.env.OTEL_METRICS_EXPORTER.trim().toLowerCase() !== "none"
  );
export const linkedTraceTopologyEnabled = (): boolean =>
  cached?.linked ??
  (!process.env.SKILLED_TRACE_TOPOLOGY?.trim() ||
    process.env.SKILLED_TRACE_TOPOLOGY.trim().toLowerCase() === "linked");
export const tracer = () => trace.getTracer("skilled");
export function startLinkedRootSpan(
  ctx: Context,
  name: string,
): { context: Context; span: Span } {
  let span: Span;
  if (!linkedTraceTopologyEnabled()) {
    span = tracer().startSpan(name, {}, ctx);
  } else {
    const parent = trace.getSpanContext(ctx);
    span = tracer().startSpan(
      name,
      {
        root: true,
        ...(parent && trace.isSpanContextValid(parent)
          ? { links: [{ context: parent }] }
          : {}),
      },
      ctx,
    );
    if (parent && trace.isSpanContextValid(parent))
      span.setAttributes({
        "skilled.linked_trace_id": parent.traceId,
        "skilled.linked_span_id": parent.spanId,
      });
  }
  return { context: trace.setSpan(ctx, span), span };
}
const allowlist = [
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
  "OTEL_EXPORTER_OTLP_PROTOCOL",
  "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL",
  "OTEL_EXPORTER_OTLP_COMPRESSION",
  "OTEL_EXPORTER_OTLP_TRACES_COMPRESSION",
  "OTEL_EXPORTER_OTLP_TIMEOUT",
  "OTEL_EXPORTER_OTLP_TRACES_TIMEOUT",
  "OTEL_TRACES_EXPORTER",
  "OTEL_SERVICE_NAME",
  "OTEL_LOG_USER_PROMPTS",
  "OTEL_LOG_TOOL_CONTENT",
  "OTEL_LOG_TOOL_DETAILS",
];
export function agentEnv(
  ctx: Context,
  currentEnv: Environment = {},
  attrs: StringAttributes = {},
): StringAttributes {
  if (!tracingEnabledForEnv(currentEnv)) return {};
  attrs = { ...agentAttributesFromContext(ctx), ...attrs };
  const env: StringAttributes = {};
  for (const k of allowlist) {
    const v = first(currentEnv[k], process.env[k]);
    if (v) env[k] = v;
  }
  let baggage = propagation.getBaggage(ctx) || propagation.createBaggage();
  for (const [k, v] of Object.entries(
    cleanAttributes(configuredAgentSpanAttributes(currentEnv)),
  ))
    baggage = baggage.setEntry(k, { value: v });
  const carrier: StringAttributes = {};
  propagator.inject(propagation.setBaggage(ctx, baggage), carrier, {
    set: (c, k, v) => {
      c[k] = v;
    },
  });
  for (const [k, v] of Object.entries(carrier)) if (v) env[k.toUpperCase()] = v;
  const span = trace.getSpanContext(ctx);
  if (span && trace.isSpanContextValid(span)) {
    attrs["skilled.parent_trace_id"] = span.traceId;
    attrs["skilled.parent_span_id"] = span.spanId;
  }
  const agentResource = parseResourceAttributes(
    first(
      currentEnv.SKILLED_AGENT_OTEL_RESOURCE_ATTRIBUTES,
      process.env.SKILLED_AGENT_OTEL_RESOURCE_ATTRIBUTES,
    ),
  );
  if (Object.keys(attrs).length || Object.keys(agentResource).length)
    env.OTEL_RESOURCE_ATTRIBUTES = mergeResourceAttributes(
      first(
        currentEnv.OTEL_RESOURCE_ATTRIBUTES,
        process.env.OTEL_RESOURCE_ATTRIBUTES,
      ),
      agentResource,
      attrs,
    );
  return env;
}
class AttributeProcessor implements SpanProcessor {
  constructor(private attrs: StringAttributes) {}
  onStart(span: SDKSpan, parent: Context): void {
    span.setAttributes({
      ...cleanAttributes(this.attrs),
      ...cleanAttributes(spanAttributesFromContext(parent)),
    });
  }
  onEnd(_span: ReadableSpan): void {}
  async shutdown(): Promise<void> {}
  async forceFlush(): Promise<void> {}
}
function protocol(signal: "TRACES" | "METRICS"): "grpc" | "http/protobuf" {
  const raw = first(
    process.env[`OTEL_EXPORTER_OTLP_${signal}_PROTOCOL`],
    process.env.OTEL_EXPORTER_OTLP_PROTOCOL,
    "grpc",
  );
  const value = raw.trim().toLowerCase();
  if (value === "grpc") return value;
  if (value === "http" || value === "http/protobuf") return "http/protobuf";
  throw new Error(
    `unsupported OTLP ${signal.toLowerCase()} protocol ${raw}; supported values: grpc, http/protobuf`,
  );
}
export async function init(
  version: string,
  ctx: Context = ROOT_CONTEXT,
): Promise<{ context: Context; shutdown: () => Promise<void> }> {
  cached = {
    tracing: tracingEnabledForEnv(),
    metrics: !!(
      process.env.OTEL_METRICS_EXPORTER?.trim() &&
      process.env.OTEL_METRICS_EXPORTER.trim().toLowerCase() !== "none"
    ),
    linked:
      !process.env.SKILLED_TRACE_TOPOLOGY?.trim() ||
      process.env.SKILLED_TRACE_TOPOLOGY.trim().toLowerCase() === "linked",
  };
  if (!cached.tracing && !cached.metrics)
    return { context: ctx, shutdown: async () => {} };
  const attrs: Attributes = {
    ...parseResourceAttributes(process.env.OTEL_RESOURCE_ATTRIBUTES || ""),
    "service.name": first(process.env.OTEL_SERVICE_NAME, "skilled"),
    ...parseResourceAttributes(
      process.env.SKILLED_OTEL_RESOURCE_ATTRIBUTES || "",
    ),
    ...(version ? { "service.version": version } : {}),
  };
  const resource = defaultResource().merge(resourceFromAttributes(attrs));
  const shutdowns: (() => Promise<void>)[] = [];
  try {
    if (cached.tracing) {
      const exporter =
        protocol("TRACES") === "grpc"
          ? new GrpcTraceExporter()
          : new HttpTraceExporter();
      const provider = new NodeTracerProvider({
        resource,
        spanProcessors: [
          new AttributeProcessor(
            parseResourceAttributes(
              process.env.SKILLED_OTEL_SPAN_ATTRIBUTES || "",
            ),
          ),
          new BatchSpanProcessor(exporter),
        ],
      });
      trace.setGlobalTracerProvider(provider);
      shutdowns.push(() => provider.shutdown());
    }
    if (cached.metrics) {
      const exp = process.env.OTEL_METRICS_EXPORTER!.trim().toLowerCase();
      if (!["otlp", "console"].includes(exp))
        throw new Error(
          `unsupported OTEL_METRICS_EXPORTER ${exp}; supported values: otlp, console, none`,
        );
      const exporter =
        exp === "console"
          ? new ConsoleMetricExporter()
          : protocol("METRICS") === "grpc"
            ? new GrpcMetricExporter()
            : new HttpMetricExporter();
      const provider = new MeterProvider({
        resource,
        readers: [new PeriodicExportingMetricReader({ exporter })],
      });
      metrics.setGlobalMeterProvider(provider);
      shutdowns.push(() => provider.shutdown());
    }
  } catch (err) {
    await Promise.allSettled(shutdowns.map((f) => f()));
    throw err;
  }
  propagation.setGlobalPropagator(propagator);
  const span = tracer().startSpan("skilled", {}, ctx);
  let closed = false;
  return {
    context: trace.setSpan(ctx, span),
    shutdown: async () => {
      if (closed) return;
      closed = true;
      span.end();
      const results = await Promise.allSettled(shutdowns.map((f) => f()));
      const errors = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => r.reason);
      if (errors.length)
        throw new AggregateError(errors, "observability shutdown failed");
    },
  };
}
let instruments: ReturnType<typeof createInstruments> | undefined;
function createInstruments() {
  const m = metrics.getMeter("skilled");
  return {
    run: m.createCounter("skilled.run.count"),
    cases: m.createCounter("skilled.case.run.count"),
    count: m.createHistogram("skilled.run.case.count"),
    duration: m.createHistogram("skilled.case.duration"),
    exec: m.createCounter("skilled.runtime.exec.count"),
    execDuration: m.createHistogram("skilled.runtime.exec.duration"),
  };
}
export function recordRunStarted(
  ctx: Context,
  engine: string,
  model: string,
  caseCount: number,
): void {
  if (!metricsEnabled()) return;
  instruments ??= createInstruments();
  const attrs = { "skilled.engine": engine, "skilled.model": model };
  instruments.run.add(1, attrs, ctx);
  instruments.count.record(caseCount, attrs, ctx);
}
export function recordCaseCompleted(
  ctx: Context,
  engine: string,
  status: string,
  durationMs: number,
): void {
  if (!metricsEnabled()) return;
  instruments ??= createInstruments();
  const attrs = { "skilled.engine": engine, "skilled.case.status": status };
  instruments.cases.add(1, attrs, ctx);
  instruments.duration.record(durationMs, attrs, ctx);
}
export function recordRuntimeExec(
  ctx: Context,
  exitCode: number,
  durationMs: number,
): void {
  if (!metricsEnabled()) return;
  instruments ??= createInstruments();
  const attrs = { "process.exit_code": exitCode };
  instruments.exec.add(1, attrs, ctx);
  instruments.execDuration.record(durationMs, attrs, ctx);
}
