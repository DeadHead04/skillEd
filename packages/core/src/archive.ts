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

/** Largest single entry the UI will inline rather than offer as a download. */
export const PREVIEW_LIMIT = 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  "md",
  "markdown",
  "txt",
  "yaml",
  "yml",
  "json",
  "jsonl",
  "csv",
  "tsv",
  "sh",
  "bash",
  "zsh",
  "py",
  "rb",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "go",
  "rs",
  "java",
  "c",
  "h",
  "cpp",
  "sql",
  "toml",
  "ini",
  "cfg",
  "conf",
  "properties",
  "xml",
  "html",
  "htm",
  "css",
  "svg",
  "patch",
  "diff",
  "gitignore",
  "dockerignore",
  "license",
]);

export type ZipEntryContent = {
  path: string;
  size: number;
  /** Decoded UTF-8 when the entry is safe to display inline. */
  text: string | null;
  /** True when the entry is binary or larger than PREVIEW_LIMIT. */
  binary: boolean;
  truncated: boolean;
};

/**
 * Read one entry out of an archive for display.
 *
 * Everything the UI shows from an uploaded package flows through here, so the
 * same traversal guard used at intake (`normalizedPath`) decides what a caller
 * is allowed to name, and content is never executed — the caller receives
 * decoded text and renders it inert.
 */
export async function readZipEntry(
  file: string,
  entryPath: string,
): Promise<ZipEntryContent> {
  const wanted = normalizedPath(entryPath);
  const bytes = await new Promise<Buffer | null>((done, reject) =>
    yauzl.open(
      file,
      { lazyEntries: true, decodeStrings: true },
      (error, zip) => {
        if (error || !zip) return reject(error ?? new Error("Malformed ZIP"));
        let settled = false;
        zip.readEntry();
        zip.on("entry", (entry) => {
          let path: string;
          try {
            path = normalizedPath(entry.fileName);
          } catch {
            return zip.readEntry();
          }
          if (path !== wanted) return zip.readEntry();
          if (entry.generalPurposeBitFlag & 1) {
            settled = true;
            zip.close();
            return reject(new Error(`Encrypted entry: ${path}`));
          }
          if (entry.uncompressedSize > ZIP_LIMITS.file) {
            settled = true;
            zip.close();
            return reject(new Error(`Entry exceeds 100 MiB: ${path}`));
          }
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              settled = true;
              zip.close();
              return reject(streamError ?? new Error("Unreadable entry"));
            }
            const chunks: Buffer[] = [];
            let total = 0;
            stream.on("data", (chunk: Buffer) => {
              total += chunk.length;
              // Stop buffering past the preview cap; the caller offers a download.
              if (total <= PREVIEW_LIMIT + 1) chunks.push(chunk);
            });
            stream.on("error", reject);
            stream.on("end", () => {
              settled = true;
              zip.close();
              done(Buffer.concat(chunks));
            });
          });
        });
        zip.on("end", () => {
          if (!settled) done(null);
        });
        zip.on("error", reject);
      },
    ),
  );

  if (!bytes) throw new Error(`Entry not found: ${wanted}`);

  const extension = wanted.includes(".")
    ? wanted.split(".").pop()!.toLowerCase()
    : wanted.split("/").pop()!.toLowerCase();
  const truncated = bytes.length > PREVIEW_LIMIT;
  const body = truncated ? bytes.subarray(0, PREVIEW_LIMIT) : bytes;
  // A NUL byte in the head is the reliable signal that this is not text,
  // whatever the extension claims.
  const looksBinary = body.subarray(0, 8192).includes(0);
  const displayable = TEXT_EXTENSIONS.has(extension) && !looksBinary;

  return {
    path: wanted,
    size: bytes.length,
    text: displayable ? body.toString("utf8") : null,
    binary: !displayable,
    truncated,
  };
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
