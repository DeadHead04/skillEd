// Modified for the skilled TypeScript distribution.
import { open, type FileHandle } from "node:fs/promises";
import type { Event } from "./event.js";
import { SerialQueue, type EventSink } from "./publisher.js";
export class JSONLSink implements EventSink {
  private queue = new SerialQueue();
  private closed = false;
  private closeError: unknown;
  constructor(private writer: FileHandle) {}
  static async open(path: string): Promise<JSONLSink> {
    return new JSONLSink(await open(path, "w", 0o600));
  }
  publish(event: Event, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const record = JSON.stringify(event).replace(
      /[<>&\u2028\u2029]/g,
      (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
    );
    if (Buffer.byteLength(record) > 1 << 20)
      return Promise.reject(
        new Error("serialized event exceeds 1048576 bytes"),
      );
    const buffer = Buffer.from(record + "\n");
    return this.queue.run(async () => {
      if (this.closed) throw new Error("JSONL event sink is closed");
      signal?.throwIfAborted();
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesWritten } = await this.writer.write(
          buffer,
          offset,
          buffer.length - offset,
        );
        if (bytesWritten <= 0 || bytesWritten > buffer.length - offset)
          throw new Error("write JSONL event: invalid write count");
        offset += bytesWritten;
      }
    });
  }
  close(): Promise<void> {
    return this.queue.run(async () => {
      if (!this.closed) {
        this.closed = true;
        try {
          await this.writer.close();
        } catch (err) {
          this.closeError = err;
        }
      }
      if (this.closeError) throw this.closeError;
    });
  }
}
export const newJSONLFileSink = JSONLSink.open;
