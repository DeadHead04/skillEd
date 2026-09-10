import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { multipart } from "../multipart";
test("multipart waits for complete file bytes and tolerates an empty optional file input", async () => {
  const form = new FormData();
  const bytes = Buffer.alloc(2 * 1024 * 1024, 7);
  form.append("skill", new Blob([bytes]), "package.zip");
  form.append("taskFile", new Blob([]), "");
  form.append("taskDescription", "Task");
  const request = new Request("http://localhost/upload", {
    method: "POST",
    body: form,
  });
  const parsed = await multipart(request);
  try {
    assert.equal(parsed.files.length, 1);
    assert.deepEqual(await readFile(parsed.files[0]!.path), bytes);
    assert.equal(parsed.fields.taskDescription, "Task");
  } finally {
    await rm(parsed.directory, { recursive: true, force: true });
  }
});
test("multipart rejects credential filenames and aborted streams", async () => {
  const form = new FormData();
  form.append("skill", new Blob(["synthetic"]), "auth.json");
  await assert.rejects(
    multipart(
      new Request("http://localhost/upload", { method: "POST", body: form }),
    ),
    /filename/,
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    multipart(
      new Request("http://localhost/upload", {
        method: "POST",
        body: new FormData(),
        signal: abort.signal,
      }),
    ),
  );
});
