import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unifiedFilePatch } from "../patches";
test("a small instruction addition produces a context hunk, not whole-file replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "skilled-patch-test-"));
  try {
    const before =
      Array.from({ length: 100 }, (_, i) => `Instruction ${i}`).join("\n") +
      "\n";
    await writeFile(join(root, "SKILL.md"), before);
    const patch = await unifiedFilePatch(root, [
      {
        path: "SKILL.md",
        action: "replace",
        content: before + "Protect the approved fields.\n",
      },
    ]);
    assert.match(patch, /\+Protect the approved fields\./);
    assert.doesNotMatch(patch, /-Instruction 0/);
    assert.ok(patch.split("\n").length < 15);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
