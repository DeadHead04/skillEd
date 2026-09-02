import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArtifactStore, sha256 } from "./artifacts";

describe("artifact store", () => {
  it("writes atomically and returns SHA-256", async () => {
    const root = await mkdtemp(join(tmpdir(), "skilled-store-"));
    const store = new ArtifactStore(root);
    const data = Buffer.from("immutable");
    const result = await store.put("runs/id/result.json", data);
    assert.equal(result.checksum, sha256(data));
    assert.equal(
      (await readFile(store.path(result.key))).toString(),
      "immutable",
    );
  });
  it("rejects user-controlled path escapes", () => {
    const store = new ArtifactStore("/tmp/store");
    assert.throws(() => store.path("../auth.json"), /Unsafe/);
    assert.throws(() => store.path("/etc/passwd"), /Unsafe/);
  });
});
