import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, posix, resolve } from "node:path";
import yauzl from "yauzl";
import yazl from "yazl";
import { sha256 } from "./artifacts";

export const ZIP_LIMITS = {
  compressed: 100 * 1024 * 1024,
  expanded: 500 * 1024 * 1024,
  entries: 10_000,
  depth: 32,
  path: 512,
  file: 100 * 1024 * 1024,
};
export type ZipEntry = {
  path: string;
  size: number;
  directory: boolean;
  mode: number;
};

function normalizedPath(value: string) {
  const replaced = value.replaceAll("\\", "/");
  if (
    replaced.startsWith("/") ||
    /^[A-Za-z]:\//.test(replaced) ||
    replaced.includes("\0")
  )
    throw new Error(`Unsafe absolute path: ${value}`);
  const clean = posix.normalize(replaced).replace(/^\.\//, "");
  if (clean === ".." || clean.startsWith("../"))
    throw new Error(`Path traversal: ${value}`);
  if (
    clean.length > ZIP_LIMITS.path ||
    clean.split("/").length > ZIP_LIMITS.depth
  )
    throw new Error(`Path limit exceeded: ${value}`);
  return clean;
}

export async function inspectZip(
  file: string,
  options: { requireSkill?: boolean } = {},
): Promise<{ entries: ZipEntry[]; roots: string[]; checksum: string }> {
  const bytes = await readFile(file);
  if (bytes.length > ZIP_LIMITS.compressed)
    throw new Error("Compressed archive exceeds 100 MiB");
  const entries: ZipEntry[] = [],
    seen = new Set<string>();
  let expanded = 0;
  await new Promise<void>((done, reject) =>
    yauzl.open(
      file,
      { lazyEntries: true, decodeStrings: true },
      (error, zip) => {
        if (error || !zip) return reject(error ?? new Error("Malformed ZIP"));
        zip.readEntry();
        zip.on("entry", (entry) => {
          try {
            const path = normalizedPath(entry.fileName);
            if (seen.has(path))
              throw new Error(`Duplicate normalized path: ${path}`);
            seen.add(path);
            const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
            const type = mode & 0o170000;
            if (
              type === 0o120000 ||
              type === 0o060000 ||
              type === 0o020000 ||
              type === 0o010000
            )
              throw new Error(`Unsupported special file: ${path}`);
            if (entry.generalPurposeBitFlag & 1)
              throw new Error(`Encrypted entry: ${path}`);
            if (entry.uncompressedSize > ZIP_LIMITS.file)
              throw new Error(`Expanded file exceeds 100 MiB: ${path}`);
            expanded += entry.uncompressedSize;
            if (expanded > ZIP_LIMITS.expanded)
              throw new Error("Expanded archive exceeds 500 MiB");
            entries.push({
              path,
              size: entry.uncompressedSize,
              directory: path.endsWith("/"),
              mode,
            });
            if (entries.length > ZIP_LIMITS.entries)
              throw new Error("Archive has more than 10,000 entries");
            zip.readEntry();
          } catch (cause) {
            zip.close();
            reject(cause);
          }
        });
        zip.on("end", done);
        zip.on("error", reject);
      },
    ),
  );
  const roots = entries
    .filter((e) => /(^|\/)SKILL\.md$/.test(e.path))
    .map((e) => posix.dirname(e.path))
    .map((p) => (p === "." ? "" : p));
  if (!roots.length && options.requireSkill !== false)
    throw new Error("No SKILL.md found");
  return { entries, roots, checksum: sha256(bytes) };
}

export async function extractZip(
  file: string,
  destination: string,
  options: { requireSkill?: boolean } = {},
) {
  const inspected = await inspectZip(file, options);
  await mkdir(destination, { recursive: true });
  await new Promise<void>((done, reject) =>
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("Malformed ZIP"));
      zip.readEntry();
      zip.on("entry", (entry) => {
        try {
          const path = normalizedPath(entry.fileName);
          const target = resolve(destination, path);
          if (!target.startsWith(`${resolve(destination)}/`))
            throw new Error("Path escape");
          if (path.endsWith("/")) {
            mkdir(target, { recursive: true }).then(
              () => zip.readEntry(),
              reject,
            );
            return;
          }
          zip.openReadStream(entry, async (streamError, stream) => {
            if (streamError || !stream) return reject(streamError);
            try {
              await mkdir(dirname(target), { recursive: true });
              const chunks: Buffer[] = [];
              for await (const chunk of stream) chunks.push(Buffer.from(chunk));
              await writeFile(target, Buffer.concat(chunks));
              zip.readEntry();
            } catch (cause) {
              reject(cause);
            }
          });
        } catch (cause) {
          reject(cause);
        }
      });
      zip.on("end", done);
      zip.on("error", reject);
    }),
  );
  return inspected;
}

export async function createZip(
  sourceRoot: string,
  entries: string[],
  output: string,
) {
  await mkdir(dirname(output), { recursive: true });
  const zip = new yazl.ZipFile();
  for (const entry of entries) zip.addFile(resolve(sourceRoot, entry), entry);
  zip.end();
  await new Promise<void>((done, reject) => {
    zip.outputStream
      .pipe(createWriteStream(output))
      .on("close", done)
      .on("error", reject);
  });
}
