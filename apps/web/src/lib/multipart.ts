import { requireStorage } from "@skilled/core";
import Busboy from "busboy";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export async function multipart(request: Request) {
  if (!request.body) throw new Error("Empty upload");
  await requireStorage(tmpdir());
  const directory = await mkdtemp(join(tmpdir(), "skilled-upload-"));
  const files: Array<{
    field: string;
    filename: string;
    path: string;
    mime: string;
  }> = [];
  const fields: Record<string, string> = {};
  const writes: Promise<void>[] = [];
  let total = 0;
  try {
    const bb = Busboy({
      headers: Object.fromEntries(request.headers),
      limits: {
        fileSize: 100 * 1024 * 1024,
        files: 30,
        fields: 60,
        fieldSize: 100_000,
      },
    });
    const input = Readable.fromWeb(request.body as never);
    const failure = (message: string) => bb.destroy(new Error(message));
    bb.on("file", (field, stream, info) => {
      stream.on("error", () => undefined);
      if (!info.filename) {
        stream.resume();
        return;
      }
      const filename = basename(info.filename.replaceAll("\\", "/"));
      if (!filename || /(^|\/)auth\.json$/i.test(filename)) {
        stream.resume();
        failure("Unsupported filename");
        return;
      }
      const path = join(directory, `${crypto.randomUUID()}-${filename}`);
      files.push({ field, filename, path, mime: info.mimeType });
      stream.on("limit", () => failure("Upload file exceeds 100 MiB"));
      const write = pipeline(
        stream,
        createWriteStream(path, { flags: "wx", mode: 0o600 }),
      );
      write.catch((cause) => bb.destroy(cause));
      writes.push(write);
    });
    bb.on("field", (name, value, info) => {
      if (info.valueTruncated) failure("Upload field exceeds limit");
      else fields[name] = value;
    });
    bb.on("filesLimit", () => failure("Too many upload files"));
    bb.on("fieldsLimit", () => failure("Too many upload fields"));
    const counter = new Transform({
      transform(chunk, _encoding, done) {
        total += chunk.length;
        done(
          total > 200 * 1024 * 1024
            ? new Error("Upload exceeds 200 MiB total")
            : null,
          chunk,
        );
      },
    });
    await pipeline(input, counter, bb, { signal: request.signal });
    await Promise.all(writes);
    return { directory, files, fields };
  } catch (error) {
    await Promise.allSettled(writes);
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
