import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import yazl from "yazl";
import { afterEach, describe, expect, it } from "vitest";
import { extractZipSafely } from "./archive";
import { ImportSafetyError } from "./errors";
import type { ImportLimits } from "./limits";

const roots: string[] = [];
const limits: ImportLimits = {
  maxArchiveBytes: 1024 * 1024,
  maxFiles: 4,
  maxUncompressedBytes: 256,
  maxFileBytes: 128,
  maxPathDepth: 5,
};

async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skilled-archive-"));
  roots.push(root);
  return root;
}

async function makeZip(
  root: string,
  entries: Array<{ name: string; content?: string; mode?: number }>,
) {
  const archive = new yazl.ZipFile();
  for (const entry of entries) {
    archive.addBuffer(Buffer.from(entry.content ?? "content"), entry.name, {
      ...(entry.mode === undefined ? {} : { mode: entry.mode }),
    });
  }
  archive.end();
  const zipPath = path.join(root, "package.zip");
  const output = createWriteStream(zipPath);
  archive.outputStream.pipe(output);
  await finished(output);
  return zipPath;
}

async function replaceArchiveName(zipPath: string, from: string, to: string) {
  expect(Buffer.byteLength(from)).toBe(Buffer.byteLength(to));
  const archive = await fs.readFile(zipPath);
  const source = Buffer.from(from);
  const target = Buffer.from(to);
  let cursor = 0;
  let replacements = 0;
  while ((cursor = archive.indexOf(source, cursor)) !== -1) {
    target.copy(archive, cursor);
    cursor += target.length;
    replacements += 1;
  }
  expect(replacements).toBeGreaterThanOrEqual(2);
  await fs.writeFile(zipPath, archive);
}

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("safe ZIP extraction", () => {
  it("extracts a bounded ordinary archive", async () => {
    const root = await temporaryRoot();
    const zipPath = await makeZip(root, [
      { name: "skill/SKILL.md", content: "hello" },
    ]);
    const destination = path.join(root, "out");

    await extractZipSafely(zipPath, destination, limits);

    await expect(
      fs.readFile(path.join(destination, "skill/SKILL.md"), "utf8"),
    ).resolves.toBe("hello");
  });

  it.each([
    ["path traversal", "safe___", "../evil"],
    ["absolute path", "safe__", "/evil_"],
  ])("rejects %s entries", async (_label, original, replacement) => {
    const root = await temporaryRoot();
    const zipPath = await makeZip(root, [{ name: original }]);
    await replaceArchiveName(zipPath, original, replacement);

    await expect(
      extractZipSafely(zipPath, path.join(root, "out"), limits),
    ).rejects.toMatchObject({
      code: "UNSAFE_ARCHIVE",
    });
  });

  it("rejects case-colliding paths", async () => {
    const root = await temporaryRoot();
    const zipPath = await makeZip(root, [{ name: "A.txt" }, { name: "a.txt" }]);
    await expect(
      extractZipSafely(zipPath, path.join(root, "out"), limits),
    ).rejects.toMatchObject({
      code: "UNSAFE_ARCHIVE",
    });
  });

  it("rejects duplicate normalized paths", async () => {
    const root = await temporaryRoot();
    const zipPath = await makeZip(root, [
      { name: "one.txt" },
      { name: "two.txt" },
    ]);
    await replaceArchiveName(zipPath, "two.txt", "one.txt");
    await expect(
      extractZipSafely(zipPath, path.join(root, "out"), limits),
    ).rejects.toMatchObject({
      code: "UNSAFE_ARCHIVE",
    });
  });

  it.each([
    ["symbolic links", 0o120777],
    ["device entries", 0o020666],
  ])("rejects %s", async (_label, mode) => {
    const root = await temporaryRoot();
    const zipPath = await makeZip(root, [{ name: "special", mode }]);
    await expect(
      extractZipSafely(zipPath, path.join(root, "out"), limits),
    ).rejects.toBeInstanceOf(ImportSafetyError);
  });

  it("enforces file count, individual file, total content, and archive limits", async () => {
    const root = await temporaryRoot();
    const tooMany = await makeZip(
      root,
      Array.from({ length: 5 }, (_, index) => ({ name: `file-${index}` })),
    );
    await expect(
      extractZipSafely(tooMany, path.join(root, "count"), limits),
    ).rejects.toMatchObject({
      code: "IMPORT_LIMIT_EXCEEDED",
    });

    const largeRoot = await temporaryRoot();
    const large = await makeZip(largeRoot, [
      { name: "large", content: "x".repeat(129) },
    ]);
    await expect(
      extractZipSafely(large, path.join(largeRoot, "large-out"), limits),
    ).rejects.toMatchObject({
      code: "IMPORT_LIMIT_EXCEEDED",
    });

    const totalRoot = await temporaryRoot();
    const total = await makeZip(totalRoot, [
      { name: "one", content: "x".repeat(128) },
      { name: "two", content: "x".repeat(128) },
      { name: "three", content: "x" },
    ]);
    await expect(
      extractZipSafely(total, path.join(totalRoot, "total-out"), limits),
    ).rejects.toMatchObject({
      code: "IMPORT_LIMIT_EXCEEDED",
    });

    const archiveRoot = await temporaryRoot();
    const archivePath = await makeZip(archiveRoot, [
      { name: "small", content: "small" },
    ]);
    await expect(
      extractZipSafely(archivePath, path.join(archiveRoot, "archive-out"), {
        ...limits,
        maxArchiveBytes: 1,
      }),
    ).rejects.toMatchObject({ code: "IMPORT_LIMIT_EXCEEDED" });
  });
});
