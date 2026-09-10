import assert from "node:assert/strict";
import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { executeBounded } from "./process.js";

// Invoked only by the credential-free isolation canary, using its measured
// native sandbox arguments. No model call or login access is involved.
assert.ok(process.argv[2], "Native sandbox arguments are required");
const args: string[] = JSON.parse(process.argv[2]);
const cwd = process.cwd();
const exists = (name: string) =>
  access(join(cwd, name)).then(
    () => true,
    () => false,
  );
await rm(join(cwd, "cancel-started"), { force: true });
await rm(join(cwd, "cancel-orphan"), { force: true });
const cancelled = await executeBounded(
  "/usr/local/bin/skilled-codex",
  [
    ...args,
    "python3",
    "-c",
    'from pathlib import Path; import time; Path("cancel-started").touch(); time.sleep(3); Path("cancel-orphan").touch()',
  ],
  { cwd, timeoutMs: 10_000, cancelled: () => exists("cancel-started") },
);
assert.equal(
  await exists("cancel-started"),
  true,
  "Sandbox command never started",
);
assert.equal(
  cancelled.cancelled,
  true,
  "Production cancellation was not exercised",
);
await delay(3200);
assert.equal(
  await exists("cancel-orphan"),
  false,
  "Cancelled sandbox left a running child",
);
const limited = await executeBounded(
  "/usr/local/bin/skilled-codex",
  [
    ...args,
    "python3",
    "-c",
    'import sys; sys.stdout.write("x" * (12 * 1024 * 1024)); sys.stdout.flush()',
  ],
  { cwd, timeoutMs: 10_000 },
);
assert.equal(limited.outputLimited, true, "Raw output limit was not enforced");
assert.ok(
  Buffer.byteLength(limited.stdout + limited.stderr) <= 10 * 1024 * 1024,
);
const timed = await executeBounded(
  "/usr/local/bin/skilled-codex",
  [...args, "python3", "-c", "import time; time.sleep(10)"],
  { cwd, timeoutMs: 500 },
);
assert.equal(timed.timedOut, true, "Production timeout was not exercised");
console.log(
  "Actual sandbox cancellation leaves no delayed child; timeout and 10 MiB raw output limit enforced",
);
