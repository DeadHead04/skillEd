import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWriteStream } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import yazl from "yazl";
import { inspectZip } from "../archive";

async function zip(entries: Array<[string, string]>) {
  const dir = await mkdtemp(join(tmpdir(), "skilled-zip-")),
    path = join(dir, "skill.zip"),
    archive = new yazl.ZipFile();
  for (const [filename, value] of entries)
    archive.addBuffer(Buffer.from(value), filename);
  archive.end();
  await new Promise<void>((resolve, reject) =>
    archive.outputStream
      .pipe(createWriteStream(path))
      .on("close", resolve)
      .on("error", reject),
  );
  return path;
}
describe("ZIP intake", () => {
  it("recursively locates Skill roots", async () => {
    const result = await inspectZip(
      await zip([
        ["bundle/one/SKILL.md", "---\nname: one\n---"],
        ["bundle/one/ref.md", "ok"],
      ]),
    );
    assert.deepEqual(result.roots, ["bundle/one"]);
    assert.equal(result.entries.length, 2);
  });
  it("requires SKILL.md", async () => {
    await assert.rejects(
      inspectZip(await zip([["README.md", "none"]])),
      /No SKILL/,
    );
  });
  it("allows a securely inspected non-Skill bundle only when explicit", async () => {
    const result = await inspectZip(await zip([["fixture.txt", "safe"]]), {
      requireSkill: false,
    });
    assert.deepEqual(result.roots, []);
    assert.equal(result.entries[0]?.path, "fixture.txt");
  });
  it("reports multiple roots for explicit selection", async () => {
    const result = await inspectZip(
      await zip([
        ["a/SKILL.md", "a"],
        ["b/SKILL.md", "b"],
      ]),
    );
    assert.deepEqual(result.roots, ["a", "b"]);
  });
});
