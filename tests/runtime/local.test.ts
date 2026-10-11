import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  NoneRuntime,
  RuntimeExecutionError,
  createRuntime,
  runProcess,
} from "../../src/runtime/index.js";
import {
  quotePOSIX,
  quoteWindows,
  quoteBashWindows,
  hostShell,
  validateShell,
  quoter,
} from "../../src/platform/index.js";
async function temp(t: test.TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "skilled-runtime-test-"));
  t.after(() => fs.rm(dir, { force: true, recursive: true }));
  return dir;
}
async function runtime(t: test.TestContext) {
  const rt = new NoneRuntime({ type: "none", delete: true });
  await rt.create();
  t.after(() => rt.close());
  return rt;
}
test("local lifecycle owns temporary workspace and preserves external workspace", async (t) => {
  const rt = await runtime(t);
  const dir = rt.workspace();
  await fs.writeFile(path.join(dir, "data"), "safe");
  await rt.close();
  await assert.rejects(fs.stat(dir), { code: "ENOENT" });
  const external = await temp(t);
  const reused = new NoneRuntime({
    type: "none",
    workspaceDir: external,
    delete: true,
  });
  await reused.create();
  await reused.close();
  assert.ok((await fs.stat(external)).isDirectory());
  await assert.rejects(
    new NoneRuntime({
      type: "none",
      workspaceDir: path.join(external, "missing"),
    }).create(),
  );
});
test("local stdout stderr nonzero, literal layered environment and cwd", async (t) => {
  const rt = await runtime(t);
  rt.mergeEnv({ VALUE: "$NOT_EXPANDED", PERSIST: "base" });
  const result = await rt.exec(
    `printf '%s:%s:' "$VALUE" "$PERSIST"; pwd; printf problem >&2; exit 7`,
    { env: { PERSIST: "call" } },
  );
  assert.equal(result.exitCode, 7);
  assert.equal(result.stderr, "problem");
  assert.equal(
    result.stdout,
    `$NOT_EXPANDED:call:${await fs.realpath(rt.workspace())}\n`,
  );
  assert.equal((await rt.exec('printf %s "$PERSIST"')).stdout, "base");
});
test("local transfer preserves executable helpers, nested paths and absolute targets", async (t) => {
  const rt = await runtime(t),
    source = await temp(t),
    out = await temp(t);
  await fs.mkdir(path.join(source, "nested"));
  await fs.writeFile(
    path.join(source, "nested", "script"),
    "#!/bin/sh\nprintf helper",
    { mode: 0o751 },
  );
  await rt.uploadDir(source, "tree");
  assert.equal((await rt.exec("./tree/nested/script")).stdout, "helper");
  await rt.uploadFile(
    path.join(source, "nested", "script"),
    path.join(rt.workspace(), "absolute"),
  );
  assert.equal(
    (await fs.stat(path.join(rt.workspace(), "absolute"))).mode & 0o777,
    0o751,
  );
  await rt.downloadDir("tree", out);
  assert.equal(
    await fs.readFile(path.join(out, "nested", "script"), "utf8"),
    "#!/bin/sh\nprintf helper",
  );
  await rt.downloadFile("absolute", path.join(out, "single"));
  assert.equal(
    await fs.readFile(path.join(out, "single"), "utf8"),
    "#!/bin/sh\nprintf helper",
  );
});
test("real timeout terminates descendants and permits next command", async (t) => {
  const rt = await runtime(t);
  const start = Date.now();
  await assert.rejects(
    rt.exec(`sleep 10 & child=$!; printf '%s' "$child"; wait`, {
      timeoutMs: 100,
    }),
    (error) =>
      error instanceof RuntimeExecutionError && error.result.stdout.length > 0,
  );
  assert.ok(Date.now() - start < 4000);
  assert.equal((await rt.exec("printf resumed")).stdout, "resumed");
});
test("abort signal preserves real partial output and graceful termination", async (t) => {
  const rt = await runtime(t),
    controller = new AbortController();
  const running = rt.exec(
    `trap 'printf cleaned; exit 0' TERM; printf ready; while :; do sleep 1; done`,
    { signal: controller.signal },
  );
  setTimeout(() => controller.abort(new Error("user cancelled")), 150);
  await assert.rejects(
    running,
    (error) =>
      error instanceof RuntimeExecutionError &&
      error.result.stdout.includes("ready"),
  );
});
test("pre-aborted execution and missing executable fail without success result", async () => {
  const signal = AbortSignal.abort(new Error("already cancelled"));
  await assert.rejects(
    runProcess(process.execPath, ["-e", "process.exit(0)"], { signal }),
    /already cancelled/,
  );
  await assert.rejects(
    runProcess("skilled-nonexistent-executable", []),
    RuntimeExecutionError,
  );
});
test("snapshot freezes independent forks and restores metadata", async (t) => {
  const rt = await runtime(t);
  const file = path.join(rt.workspace(), "input");
  await fs.writeFile(file, "original");
  const timestamp = new Date("2023-01-02T03:04:05Z");
  await fs.utimes(file, timestamp, timestamp);
  const snapshot = await rt.captureJudgeSnapshot();
  t.after(() => snapshot.close());
  await fs.writeFile(file, "changed original");
  const first = await snapshot.fork(),
    second = await snapshot.fork();
  t.after(first.cleanup);
  t.after(second.cleanup);
  await first.runtime.exec("printf judge > input");
  assert.equal(
    await fs.readFile(path.join(second.runtime.workspace(), "input"), "utf8"),
    "original",
  );
  assert.equal(
    (
      await fs.stat(path.join(second.runtime.workspace(), "input"))
    ).mtime.getTime(),
    timestamp.getTime(),
  );
  assert.equal(await fs.readFile(file, "utf8"), "changed original");
});
test("snapshot preserves internal links and rejects external and Git metadata pointers", async (t) => {
  const rt = await runtime(t),
    outside = await temp(t);
  await fs.writeFile(path.join(rt.workspace(), "data"), "ok");
  await fs.symlink("data", path.join(rt.workspace(), "inside"));
  const snap = await rt.captureJudgeSnapshot();
  const fork = await snap.fork();
  assert.equal(
    await fs.readFile(path.join(fork.runtime.workspace(), "inside"), "utf8"),
    "ok",
  );
  await fork.cleanup();
  await snap.close();
  await fs.symlink(outside, path.join(rt.workspace(), "outside"));
  await assert.rejects(rt.captureJudgeSnapshot(), /outside workspace/);
  await fs.unlink(path.join(rt.workspace(), "outside"));
  await fs.writeFile(path.join(rt.workspace(), ".git"), "gitdir: elsewhere");
  await assert.rejects(rt.captureJudgeSnapshot(), /Git metadata pointer/);
});
test("snapshot cleanup handles read-only directories and aborted copy", async (t) => {
  const rt = await runtime(t);
  await fs.mkdir(path.join(rt.workspace(), "readonly"));
  await fs.writeFile(path.join(rt.workspace(), "readonly", "data"), "ok");
  await fs.chmod(path.join(rt.workspace(), "readonly"), 0o500);
  const snapshot = await rt.captureJudgeSnapshot();
  await snapshot.close();
  await assert.rejects(
    rt.captureJudgeSnapshot(AbortSignal.abort(new Error("stop copy"))),
    /stop copy/,
  );
});
test("shell quotation sends literal metacharacters to real shell", async (t) => {
  const rt = await runtime(t);
  for (const text of [
    "it's literal",
    "$HOME `touch should-not-exist`",
    "C:\\path with spaces\\",
    "\n; echo dangerous",
  ])
    assert.equal(
      (await rt.exec("printf %s " + quoter(rt.shell())(text))).stdout,
      text,
    );
  await assert.rejects(fs.stat(path.join(rt.workspace(), "should-not-exist")));
  assert.equal(quoteWindows("tail\\"), '"tail\\\\"');
  assert.equal(quoteBashWindows("$HOME"), '"\\$HOME"');
  assert.equal(quotePOSIX("a'b"), "'a'\\''b'");
  validateShell(hostShell().target);
  assert.throws(() => validateShell({ goos: "linux", family: "cmd" }));
  assert.throws(() => createRuntime({ type: "unknown" } as never));
});

test("timeout escalates resistant descendants before they can mutate workspace", async (t) => {
  const rt = await runtime(t);
  await assert.rejects(
    rt.exec(
      "sh -c 'trap \"\" TERM; sleep 2; printf leaked > late-write' & wait",
      { timeoutMs: 100 },
    ),
    RuntimeExecutionError,
  );
  await new Promise((resolve) => setTimeout(resolve, 2200));
  await assert.rejects(fs.stat(path.join(rt.workspace(), "late-write")), {
    code: "ENOENT",
  });
});

test("clean parent exit with a retained child pipe remains successful and bounded", async (t) => {
  const rt = await runtime(t);
  const started = Date.now();
  const result = await rt.exec("sleep 3 & printf parent-done; exit 0");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "parent-done");
  assert.ok(Date.now() - started < 2800);
});

test("snapshot traverses symlinked root and rejects a chained escaping link", async (t) => {
  const parent = await temp(t);
  const actual = path.join(parent, "actual");
  await fs.mkdir(actual);
  await fs.writeFile(path.join(actual, "data"), "ok");
  await fs.symlink(actual, path.join(parent, "workspace"));
  const rt = new NoneRuntime({
    type: "none",
    workspaceDir: path.join(parent, "workspace"),
  });
  await rt.create();
  const snapshot = await rt.captureJudgeSnapshot();
  await snapshot.close();
  await fs.symlink(parent, path.join(actual, "escape"));
  await fs.symlink("escape", path.join(actual, "chained"));
  await assert.rejects(rt.captureJudgeSnapshot(), /outside workspace/);
});

test("directory copies retain existing destination modes; single file upload refreshes them", async (t) => {
  const rt = await runtime(t),
    source = await temp(t);
  await fs.writeFile(path.join(source, "helper"), "executable", {
    mode: 0o751,
  });
  await fs.mkdir(path.join(rt.workspace(), "target"), { mode: 0o700 });
  await fs.writeFile(path.join(rt.workspace(), "target", "helper"), "old", {
    mode: 0o600,
  });
  await rt.uploadDir(source, "target");
  assert.equal(
    (await fs.stat(path.join(rt.workspace(), "target"))).mode & 0o777,
    0o700,
  );
  assert.equal(
    (await fs.stat(path.join(rt.workspace(), "target", "helper"))).mode & 0o777,
    0o600,
  );
  assert.equal(
    await fs.readFile(path.join(rt.workspace(), "target", "helper"), "utf8"),
    "executable",
  );
  await rt.uploadFile(path.join(source, "helper"), "target/helper");
  assert.equal(
    (await fs.stat(path.join(rt.workspace(), "target", "helper"))).mode & 0o777,
    0o751,
  );
});
