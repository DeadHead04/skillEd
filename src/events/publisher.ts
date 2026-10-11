// Modified for the skilled TypeScript distribution.
import { randomUUID } from "node:crypto";
import {
  type Event,
  type EventType,
  type PayloadMap,
  validatePayload,
  stringValue,
  MAX_SAFE_INTEGER,
} from "./event.js";
export interface EventSink {
  publish(event: Event, signal?: AbortSignal): Promise<void>;
  close(): Promise<void>;
}
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn);
    this.tail = next.catch(() => {});
    return next;
  }
}
export function validateAttributes(
  attributes: Record<string, string> = {},
  user = false,
): Record<string, string> {
  if (Object.keys(attributes).length > 32)
    throw new Error("attributes exceed the limit of 32");
  const copy: Record<string, string> = {};
  for (const [k, v] of Object.entries(attributes)) {
    stringValue("attribute key", k);
    if (
      Buffer.byteLength(k) > 128 ||
      !/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/.test(k)
    )
      throw new Error(`invalid attribute key ${k}`);
    if (user && k.startsWith("skilled."))
      throw new Error(`attribute key ${k} uses the reserved skilled namespace`);
    stringValue(`attribute ${k}`, v, true);
    if (Buffer.byteLength(v) > 1024)
      throw new Error(`attribute ${k} value exceeds 1024 bytes`);
    Object.defineProperty(copy, k, { value: v, enumerable: true });
  }
  // Go's JSON encoder escapes HTML characters when checking the byte budget.
  const json = JSON.stringify(copy).replace(
    /[<>&\u2028\u2029]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
  if (Buffer.byteLength(json) > 16 * 1024)
    throw new Error("attributes exceed the limit of 16384 bytes");
  return copy;
}
export function validateUserAttributes(
  attributes: Record<string, string>,
): void {
  validateAttributes(attributes, true);
}
export class Publisher {
  readonly invocationID: string;
  private readonly queue = new SerialQueue();
  private readonly attributes: Record<string, string>;
  private sequence = 1;
  private finalized = false;
  private closed = false;
  private error: Error | undefined;
  constructor(
    private readonly sink: EventSink,
    options: {
      attributes?: Record<string, string>;
      invocationID?: string;
    } = {},
  ) {
    if (!sink) throw new Error("event sink must not be nil");
    this.attributes = validateAttributes(options.attributes);
    let id = options.invocationID || randomUUID();
    id = id.replace(/^urn:uuid:/i, "").replace(/^\{(.*)\}$/, "$1");
    if (/^[a-f\d]{32}$/i.test(id))
      id = `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
    if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(id))
      throw new Error("invalid invocation ID");
    this.invocationID = id.toLowerCase();
  }
  publish<K extends EventType>(
    type: K,
    payload: PayloadMap[K],
    signal?: AbortSignal,
  ): Promise<void> {
    return this.write(type, payload, false, signal);
  }
  publishLast<K extends EventType>(
    type: K,
    payload: PayloadMap[K],
    signal?: AbortSignal,
  ): Promise<void> {
    return this.write(type, payload, true, signal);
  }
  private write<K extends EventType>(
    type: K,
    payload: PayloadMap[K],
    last: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    const snapshot = structuredClone(payload);
    return this.queue.run(async () => {
      if (this.closed) throw new Error("publisher is closed");
      if (this.finalized)
        throw new Error("publisher already published its last event");
      if (this.error) throw this.error;
      validatePayload(type, snapshot);
      if (this.sequence > MAX_SAFE_INTEGER)
        throw new Error("sequence number exceeds safe integer");
      const event = {
        protocol_version: 1,
        event_version: 1,
        sequence_number: this.sequence,
        invocation_id: this.invocationID,
        time: new Date().toISOString(),
        event: type,
        payload: snapshot,
        ...(last ? { last_event: true } : {}),
        ...(Object.keys(this.attributes).length
          ? { attributes: { ...this.attributes } }
          : {}),
      } as Event;
      try {
        await this.sink.publish(event, signal);
      } catch (err) {
        this.error = new Error(`publish ${type} event: ${String(err)}`, {
          cause: err,
        });
        throw this.error;
      }
      this.sequence++;
      if (last) this.finalized = true;
    });
  }
  err(): Error | undefined {
    return this.error;
  }
  close(): Promise<void> {
    return this.queue.run(async () => {
      if (!this.closed) {
        this.closed = true;
        try {
          await this.sink.close();
        } catch (err) {
          this.error = new AggregateError(
            [...(this.error ? [this.error] : []), err],
            "close event sink",
          );
        }
      }
      if (this.error) throw this.error;
    });
  }
}
