import test from "node:test";
import assert from "node:assert/strict";
import { apiFetch, safeRedirect } from "../client-request";
test("uncertain network/proxy responses retain retry keys and redirects remain same-origin", async () => {
  const original = globalThis.fetch;
  const keys: string[] = [];
  let attempt = 0;
  globalThis.fetch = async (_url, options) => {
    keys.push(new Headers(options?.headers).get("idempotency-key")!);
    if (++attempt === 1)
      return new Response("<html>Gateway unavailable</html>", { status: 502 });
    return Response.json({ resourceId: "same-operation" });
  };
  try {
    const input = { method: "POST", body: '{"example":true}' };
    assert.equal((await apiFetch("/synthetic/retry", input)).status, 503);
    assert.equal((await apiFetch("/synthetic/retry", input)).status, 200);
    assert.equal(keys[0], keys[1]);
    await apiFetch("/synthetic/retry", input);
    assert.notEqual(keys[1], keys[2]);
    for (const next of [
      "//outside.example",
      "/\\outside.example",
      "https://outside.example",
    ])
      assert.equal(safeRedirect(next, "https://skilled.example"), "/skill");
    assert.equal(
      safeRedirect("/runs/new?skill=example", "https://skilled.example"),
      "/runs/new?skill=example",
    );
  } finally {
    globalThis.fetch = original;
  }
});
