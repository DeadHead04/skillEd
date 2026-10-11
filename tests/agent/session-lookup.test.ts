import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  utimes,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { NoneRuntime } from "../../src/runtime/none.js";
import {
  canonicalWorkspaceKey,
  workspaceCwdMarkers,
  buildWindowsSessionLookupScript,
  sessionCleanupOptions,
  withDownloadedSession,
} from "../../src/agent/session-lookup.js";
import {
  findQoderSessionFile,
  findQoderSessionFileInConfigDir,
} from "../../src/agent/qodercli.js";
import { findQwenCodeSessionFile } from "../../src/agent/qwen-code.js";
async function session(file: string, body: string, seconds = 0) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
  const date = new Date(Date.now() + seconds * 1000);
  await utimes(file, date, date);
  return file;
}
async function setup(name = "workspace_a.b") {
  const root = await mkdtemp(path.join(os.tmpdir(), "skilled-session-test-")),
    workspace = path.join(root, name),
    home = path.join(root, "home");
  await mkdir(workspace);
  await mkdir(home);
  const rt = new NoneRuntime({
    type: "none",
    workspaceDir: workspace,
    env: { HOME: home },
  });
  await rt.create();
  return {
    root,
    workspace: await realpath(workspace),
    home,
    rt,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
for (const rule of ["hyphens", "spaces", "underscores", "hashed"])
  test("session lookup through actual shell handles " + rule, async () => {
    const s = await setup("work space_a.b");
    try {
      const key =
        rule === "hyphens"
          ? canonicalWorkspaceKey(s.workspace)
          : rule === "spaces"
            ? s.workspace.replaceAll("/", "-")
            : rule === "underscores"
              ? s.workspace.replace(/[^A-Za-z0-9]/g, "_")
              : "short-hash";
      const expected = await session(
        path.join(s.home, ".qoder", "projects", key, "main.jsonl"),
        rule === "hashed"
          ? JSON.stringify({ cwd: s.workspace })
          : JSON.stringify({ type: "user", message: { content: "hello" } }),
      );
      assert.equal(await findQoderSessionFile(s.rt), expected);
    } finally {
      await s.cleanup();
    }
  });
test("real session lookup disambiguates collisions, nested agents, path mentions and newer unrelated files", async () => {
  const s = await setup();
  try {
    const dir = path.join(
        s.home,
        ".qoder",
        "projects",
        canonicalWorkspaceKey(s.workspace),
      ),
      own = await session(
        path.join(dir, "own.jsonl"),
        JSON.stringify({ cwd: s.workspace }),
        -120,
      );
    await session(
      path.join(dir, "other.jsonl"),
      JSON.stringify({
        cwd: s.workspace.replace("workspace_a", "workspace-a"),
        tool: { path: s.workspace },
      }),
      0,
    );
    await session(
      path.join(dir, "own", "subagents", "agent.jsonl"),
      JSON.stringify({ cwd: s.workspace }),
      10,
    );
    assert.equal(await findQoderSessionFile(s.rt), own);
    await rm(own);
    assert.equal(await findQoderSessionFile(s.rt), "");
  } finally {
    await s.cleanup();
  }
});
test("identity-less sessions use newest mtime and Qwen searches chats depth", async () => {
  const s = await setup();
  try {
    const key = canonicalWorkspaceKey(s.workspace),
      base = path.join(s.home, ".qoder", "projects", key);
    await session(path.join(base, "old.jsonl"), "{}", -10);
    const newest = await session(path.join(base, "new.jsonl"), "{}");
    assert.equal(await findQoderSessionFile(s.rt), newest);
    const qwen = await session(
      path.join(s.home, ".qwen", "projects", key, "chats", "chat.jsonl"),
      "{}",
    );
    assert.equal(await findQwenCodeSessionFile(s.rt), qwen);
    const cn = await session(
      path.join(s.home, ".qoder-cn", "projects", key, "cn.jsonl"),
      "{}",
    );
    assert.equal(await findQoderSessionFileInConfigDir(s.rt, ".qoder-cn"), cn);
  } finally {
    await s.cleanup();
  }
});
test("session lookup preserves special-character workspace and physical symlink identity", async () => {
  const s = await setup("a&b<point>");
  try {
    const expected = await session(
      path.join(s.home, ".qoder", "projects", "short-hash", "main.jsonl"),
      JSON.stringify({ cwd: s.workspace }),
    );
    assert.equal(await findQoderSessionFile(s.rt), expected);
    const alias = path.join(s.root, "alias");
    await symlink(s.workspace, alias);
    const rt = new NoneRuntime({
      type: "none",
      workspaceDir: alias,
      env: { HOME: s.home },
    });
    await rt.create();
    assert.equal(await findQoderSessionFile(rt), expected);
  } finally {
    await s.cleanup();
  }
});
test("Windows lookup generation uses encoded identity and case folding without claiming Windows execution", () => {
  assert.deepEqual(workspaceCwdMarkers("C:\\Users\\Test"), [
    '"cwd":"C:\\\\Users\\\\Test"',
    '"cwd": "C:\\\\Users\\\\Test"',
    '"directories":["C:\\\\Users\\\\Test"',
    '"directories":[ "C:\\\\Users\\\\Test"',
  ]);
  const script = buildWindowsSessionLookupScript({
    projectsRootTmpl: "$home/.claude/projects",
  });
  assert.match(script, /tolower\(n\)==tolower\(key\)/);
  assert.match(script, /grep -qiFf/);
  assert.match(script, /cygpath -w/);
});
test("post-cancel cleanup downloads actual files, registers artifact and cleans temporary paths", async () => {
  const s = await setup();
  try {
    const file = await session(
      path.join(s.workspace, "transcript.jsonl"),
      "{}",
    );
    const opts = sessionCleanupOptions({ signal: AbortSignal.abort() });
    assert.equal(opts.signal?.aborted, false);
    let local = "";
    const download = await withDownloadedSession(
      s.rt,
      "",
      file,
      [],
      async (p) => {
        local = p;
      },
      opts,
    );
    assert.notEqual(local, file);
    assert.deepEqual(download.files, [file]);
    await download.cleanup();
    await assert.rejects(
      import("node:fs/promises").then((fs) => fs.stat(local)),
    );
  } finally {
    await s.cleanup();
  }
});
