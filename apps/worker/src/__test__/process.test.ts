import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeBounded, executionEnvironment } from "../process";

test(
  "execution strips service secrets, distinguishes timeouts, bounds logs and cleans descendant processes",
  { skip: process.platform !== "linux" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "skilled-process-"));
    try {
      const env = executionEnvironment();
      for (const key of [
        "DATABASE_URL",
        "EXECUTOR_SERVICE_TOKEN",
        "ARTIFACT_SIGNING_KEY",
        "SKILLED_SESSION_SECRET",
      ])
        assert.equal(env[key], undefined);
      await assert.rejects(
        executeBounded("/nonexistent/skilled-test-command", [], { cwd: root }),
        /ENOENT/,
      );
      const timeout = await executeBounded(
        process.execPath,
        ["-e", "setInterval(()=>{},1000)"],
        { cwd: root, timeoutMs: 300 },
      );
      assert.equal(timeout.timedOut, true);
      assert.equal(timeout.cancelled, false);
      const limited = await executeBounded(
        process.execPath,
        [
          "-e",
          "process.stdout.write('x'.repeat(12*1024*1024)); setInterval(()=>{},1000)",
        ],
        { cwd: root },
      );
      assert.equal(limited.outputLimited, true);
      assert.ok(Buffer.byteLength(limited.stdout) <= 10 * 1024 * 1024);
      let ready = false;
      const descendant =
        "setTimeout(()=>require('node:fs').writeFileSync('orphan-marker','escaped'),1800)";
      const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'}); console.log('ready'); setInterval(()=>{},1000)`;
      const cancelled = await executeBounded(process.execPath, ["-e", parent], {
        cwd: root,
        onStdout: () => {
          ready = true;
        },
        cancelled: async () => ready,
      });
      assert.equal(cancelled.cancelled, true);
      await new Promise((resolve) => setTimeout(resolve, 1900));
      await assert.rejects(access(join(root, "orphan-marker")));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
