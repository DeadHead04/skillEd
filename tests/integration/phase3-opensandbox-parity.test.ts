import test from "node:test";
import assert from "node:assert/strict";
import { OpenSandboxRuntime } from "../../src/runtime/opensandbox.js";
test(
  "actual OpenSandbox stdout behavior matches original Go on the pinned local execd service",
  { skip: process.env.SKILLED_REAL_OPENSANDBOX !== "1", timeout: 60_000 },
  async () => {
    const rt = new OpenSandboxRuntime({
      type: "opensandbox",
      image: "node:22",
      delete: true,
      kwargs: { base_url: process.env.SKILLED_REAL_OPENSANDBOX_BASE_URL ?? "" },
      useServerProxy: process.env.SKILLED_REAL_OPENSANDBOX_PROXY === "1",
    });
    try {
      await rt.create();
      await rt.start();
      assert.equal(
        (await rt.exec("printf 'first\\nsecond\\n'")).stdout,
        "firstsecond",
        "Pinned original Go with this service also loses stdout line breaks; if service changes, recapture original behavior before changing this expectation.",
      );
    } finally {
      await rt.close();
    }
  },
);
