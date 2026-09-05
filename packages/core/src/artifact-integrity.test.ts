import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { ArtifactStore } from "./artifacts";
import { signArtifactGrant, verifyArtifactGrant } from "./grants";
import { createZip, extractZip } from "./archive";
import { parseSkillMetadata } from "./intake";

test("artifact grants authorize one object and operation; tampering fails", () => {
  const pair = generateKeyPairSync("ed25519");
  const privateKey = pair.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const publicKey = pair.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const token = signArtifactGrant(
    { key: "outputs/exact.json", operation: "write", maxBytes: 100 },
    privateKey,
  );
  assert.equal(
    verifyArtifactGrant(token, "outputs/exact.json", "write", publicKey)
      .maxBytes,
    100,
  );
  assert.throws(() =>
    verifyArtifactGrant(token, "outputs/another.json", "write", publicKey),
  );
  assert.throws(() =>
    verifyArtifactGrant(token, "outputs/exact.json", "read", publicKey),
  );
  assert.throws(() =>
    verifyArtifactGrant(
      `tampered.${token.split(".")[1]}`,
      "outputs/exact.json",
      "write",
      publicKey,
    ),
  );
});
test("immutable streamed artifacts survive duplicate writes and clean failed streams", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skilled-artifact-test-"));
  const store = new ArtifactStore(dir);
  try {
    const saved = await store.put("case/output", Buffer.from("first"));
    await store.put("case/output", Buffer.from("first"));
    assert.equal(
      (
        await readFile(store.path(`objects/sha256/${saved.checksum}`))
      ).toString(),
      "first",
    );
    await assert.rejects(
      store.put("case/output", Buffer.from("changed")),
      /Immutable/,
    );
    await assert.rejects(
      store.putStream("case/oversized", Readable.from(["too much"]), 2),
    );
    await assert.rejects(
      store.putStream(
        "case/aborted",
        Readable.from(
          (async function* () {
            yield "first";
            throw new Error("disconnected");
          })(),
        ),
        100,
      ),
    );
    assert.deepEqual(await readdir(join(dir, "case")), ["output"]);
    for (const key of [
      "../escape",
      "/absolute",
      "a\\b",
      "auth.json",
      "nested/auth.json",
    ])
      assert.throws(() => store.path(key));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("ZIP extraction preserves safe executable files and parses structural metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skilled-zip-mode-"));
  const source = join(dir, "source");
  await mkdir(source);
  try {
    await writeFile(
      join(source, "SKILL.md"),
      '---\nname: "Skill: exact"\ndescription: |\n  Multiple lines\n  remain meaningful\n---\nBody',
    );
    await writeFile(join(source, "helper.sh"), "#!/bin/sh\necho fixture\n", {
      mode: 0o755,
    });
    const zip = join(dir, "package.zip");
    await createZip(source, ["SKILL.md", "helper.sh"], zip);
    await extractZip(zip, join(dir, "out"));
    assert.equal((await stat(join(dir, "out/helper.sh"))).mode & 0o777, 0o755);
    assert.equal(
      parseSkillMetadata(await readFile(join(source, "SKILL.md"), "utf8")).name,
      "Skill: exact",
    );
    assert.throws(
      () =>
        parseSkillMetadata(
          "---\nname: first\nname: second\ndescription: text\n---\n",
        ),
      /frontmatter/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
