// Modified for the skilled TypeScript distribution.
import { format } from "node:util";
import { context, trace, type Context } from "@opentelemetry/api";
import type { Writable } from "node:stream";
let verbosity = 0;
let output: Pick<Writable, "write"> = process.stdout;
let includeMessage: boolean | undefined;
export function setVerbosity(value: number): void {
  verbosity = value;
}
export function verboseEnabled(): boolean {
  return verbosity >= 1;
}
export function setOutput(writer: Pick<Writable, "write">): () => void {
  const original = output;
  output = writer;
  return () => {
    output = original;
  };
}
export type Level = "TRACE" | "DEBUG" | "INFO" | "WARNING" | "ERROR";
function log(
  ctx: Context,
  level: Level,
  message: string,
  args: unknown[],
): void {
  if (
    (level === "TRACE" && verbosity < 2) ||
    (level === "DEBUG" && verbosity < 1)
  )
    return;
  const msg = format(message, ...args);
  const span = trace.getSpan(ctx);
  if (span && trace.isSpanContextValid(span.spanContext())) {
    includeMessage ??= !["0", "false"].includes(
      (process.env.SKILLED_OTEL_LOG_MESSAGE || "").trim().toLowerCase(),
    );
    span.addEvent("skilled.log", {
      "log.severity": level,
      ...(includeMessage ? { "log.message": msg } : {}),
    });
  }
  const escaped =
    /[\s="\\]|[\x00-\x1f\x7f]/.test(msg) || !msg ? JSON.stringify(msg) : msg;
  output.write(`level=${level} msg=${escaped}\n`);
}
export const infoContextf = (ctx: Context, f: string, ...a: unknown[]): void =>
  log(ctx, "INFO", f, a);
export const debugContextf = (ctx: Context, f: string, ...a: unknown[]): void =>
  log(ctx, "DEBUG", f, a);
export const traceContextf = (ctx: Context, f: string, ...a: unknown[]): void =>
  log(ctx, "TRACE", f, a);
export const warnContextf = (ctx: Context, f: string, ...a: unknown[]): void =>
  log(ctx, "WARNING", f, a);
export const errorContextf = (ctx: Context, f: string, ...a: unknown[]): void =>
  log(ctx, "ERROR", f, a);
export const infof = (f: string, ...a: unknown[]): void =>
  infoContextf(context.active(), f, ...a);
export const debugf = (f: string, ...a: unknown[]): void =>
  debugContextf(context.active(), f, ...a);
export const tracef = (f: string, ...a: unknown[]): void =>
  traceContextf(context.active(), f, ...a);
export const warnf = (f: string, ...a: unknown[]): void =>
  warnContextf(context.active(), f, ...a);
export const errorf = (f: string, ...a: unknown[]): void =>
  errorContextf(context.active(), f, ...a);
