import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSystemArtifactStore } from "./index";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("FileSystemArtifactStore", () => {
  it("stores immutable content and reuses an existing checksum", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "skilled-artifacts-"));
    temporary.push(base);
    const source = path.join(base, "source");
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, "SKILL.md"), "fixture");
    const store = new FileSystemArtifactStore(path.join(base, "store"));
    const checksum = "a".repeat(64);
    const first = await store.storeDirectory(source, checksum);
    const second = await store.storeDirectory(source, checksum);
    expect(second).toBe(first);
    expect((await store.readFile(first, "SKILL.md")).toString()).toBe(
      "fixture",
    );
    expect(() => store.resolveFile(first, "../outside")).toThrow();
  });
});
