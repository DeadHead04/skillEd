import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import type { ImportLimits } from "./limits";
import { ImportSafetyError } from "./errors";
import { normalizePackagePath, resolveInside } from "./path";

function openZip(filePath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      filePath,
      { lazyEntries: true, decodeStrings: true },
      (error, zip) => {
        if (error || !zip)
          reject(error ?? new Error("Unable to open ZIP archive."));
        else resolve(zip);
      },
    );
  });
}

function openEntry(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream)
        reject(error ?? new Error("Unable to read ZIP entry."));
      else resolve(stream);
    });
  });
}

function unixType(entry: Entry): number {
  return (entry.externalFileAttributes >>> 16) & 0o170000;
}

export async function extractZipSafely(
  zipPath: string,
  destination: string,
  limits: ImportLimits,
): Promise<void> {
  const archiveStat = await fs.stat(zipPath);
  if (archiveStat.size > limits.maxArchiveBytes) {
    throw new ImportSafetyError(
      "IMPORT_LIMIT_EXCEEDED",
      "Archive exceeds the upload limit.",
    );
  }
  await fs.mkdir(destination, { recursive: true });

  const zip = await openZip(zipPath);
  const seen = new Set<string>();
  let fileCount = 0;
  let totalBytes = 0;

  await new Promise<void>((resolve, reject) => {
    const fail = (error: unknown) => {
      zip.close();
      reject(
        error instanceof ImportSafetyError
          ? error
          : new ImportSafetyError(
              "UNSAFE_ARCHIVE",
              "Archive is malformed or unsafe.",
            ),
      );
    };

    zip.on("error", fail);
    zip.on("end", resolve);
    zip.on("entry", (entry) => {
      void (async () => {
        try {
          const normalized = normalizePackagePath(
            entry.fileName,
            limits.maxPathDepth,
          );
          const collisionKey = normalized.toLocaleLowerCase("en-US");
          if (seen.has(collisionKey)) {
            throw new ImportSafetyError(
              "UNSAFE_ARCHIVE",
              "Archive contains duplicate paths.",
            );
          }
          seen.add(collisionKey);

          const type = unixType(entry);
          const isDirectory = entry.fileName.endsWith("/") || type === 0o040000;
          if (type === 0o120000) {
            throw new ImportSafetyError(
              "UNSAFE_ARCHIVE",
              "Archive contains a symbolic link.",
            );
          }
          if (type !== 0 && type !== 0o100000 && type !== 0o040000) {
            throw new ImportSafetyError(
              "UNSAFE_ARCHIVE",
              "Archive contains a device or special file.",
            );
          }

          const target = resolveInside(destination, normalized);
          if (isDirectory) {
            await fs.mkdir(target, { recursive: true });
            zip.readEntry();
            return;
          }

          fileCount += 1;
          totalBytes += entry.uncompressedSize;
          if (
            fileCount > limits.maxFiles ||
            entry.uncompressedSize > limits.maxFileBytes ||
            totalBytes > limits.maxUncompressedBytes
          ) {
            throw new ImportSafetyError(
              "IMPORT_LIMIT_EXCEEDED",
              "Archive exceeds extraction limits.",
            );
          }

          await fs.mkdir(path.dirname(target), { recursive: true });
          const stream = await openEntry(zip, entry);
          let actualBytes = 0;
          const limiter = new Transform({
            transform(chunk, _encoding, callback) {
              actualBytes += Buffer.byteLength(chunk);
              if (actualBytes > limits.maxFileBytes) {
                callback(
                  new ImportSafetyError(
                    "IMPORT_LIMIT_EXCEEDED",
                    "File exceeds extraction limit.",
                  ),
                );
                return;
              }
              callback(null, chunk);
            },
          });
          await pipeline(
            stream,
            limiter,
            createWriteStream(target, { flags: "wx", mode: 0o600 }),
          );
          zip.readEntry();
        } catch (error) {
          fail(error);
        }
      })();
    });
    zip.readEntry();
  });
}
