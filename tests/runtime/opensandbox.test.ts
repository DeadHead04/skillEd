import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  OpenSandboxRuntime,
  RuntimeExecutionError,
} from "../../src/runtime/index.js";
const enabled = process.env.SKILLED_REAL_OPENSANDBOX === "1";
test(
  "real OpenSandbox lifecycle, command and nested file transfer",
  { skip: !enabled && "set SKILLED_REAL_OPENSANDBOX=1", timeout: 180000 },
  async (t) => {
    const rt = new OpenSandboxRuntime({
      type: "opensandbox",
      image: process.env.SKILLED_REAL_OPENSANDBOX_IMAGE || "node:22",
      delete: true,
      kwargs: {
        base_url: process.env.SKILLED_REAL_OPENSANDBOX_BASE_URL || "",
        request_timeout_seconds: "60",
      },
      useServerProxy: process.env.SKILLED_REAL_OPENSANDBOX_PROXY === "1",
      readyTimeoutMs: 90000,
      sandboxTimeoutMs: 300000,
      env: { BASE: "base" },
    });
    t.after(() => rt.close());
    await rt.create();
    await rt.start();
    assert.ok(rt.sandboxID());
    rt.mergeEnv({ BASE: "merged" });
    assert.equal(
      (
        await rt.exec('printf %s "$BASE:$LITERAL"', {
          env: { LITERAL: "$HOME" },
        })
      ).stdout,
      "merged:$HOME",
    );
    assert.equal((await rt.exec("printf failure >&2; exit 9")).exitCode, 9);
    const source = await fs.mkdtemp(
      path.join(os.tmpdir(), "skilled-sandbox-test-"),
    );
    t.after(() => fs.rm(source, { recursive: true, force: true }));
    await fs.mkdir(path.join(source, "in", "nested"), { recursive: true });
    await fs.writeFile(
      path.join(source, "in", "nested", "helper"),
      "#!/bin/sh\nprintf uploaded",
      { mode: 0o751 },
    );
    await rt.uploadDir(path.join(source, "in"), "input");
    assert.equal((await rt.exec("./input/nested/helper")).stdout, "uploaded");
    await rt.uploadFile(path.join(source, "in", "nested", "helper"), "single");
    await rt.downloadFile("single", path.join(source, "single"));
    assert.equal(
      await fs.readFile(path.join(source, "single"), "utf8"),
      "#!/bin/sh\nprintf uploaded",
    );
    await rt.downloadDir("input", path.join(source, "out"));
    assert.equal(
      await fs.readFile(path.join(source, "out", "nested", "helper"), "utf8"),
      "#!/bin/sh\nprintf uploaded",
    );
    try {
      const timed = await rt.exec("sleep 1; printf leaked > late-write", {
        timeoutMs: 100,
      });
      assert.notEqual(timed.exitCode, 0);
    } catch (error) {
      assert.ok(error instanceof RuntimeExecutionError);
      assert.equal(error.result.exitCode, -1);
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.notEqual((await rt.exec("test -f late-write")).exitCode, 0);
    await rt.close();
    assert.equal(rt.sandboxID(), undefined);
  },
);
