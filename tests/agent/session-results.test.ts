import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { NoneRuntime } from "../../src/runtime/none.js";
import { QoderCLIAgent } from "../../src/agent/qodercli.js";
import { QwenCodeAgent } from "../../src/agent/qwen-code.js";
import { CodexAgent, prepareCodexRunArtifacts } from "../../src/agent/codex.js";
import { canonicalWorkspaceKey } from "../../src/agent/session-lookup.js";
const jsonl = (...events: unknown[]) =>
  events.map((e) => JSON.stringify(e)).join("\n");
async function setup() {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "skilled-session-result-")),
  );
  const home = path.join(root, "home");
  await mkdir(home);
  await mkdir(path.join(root, "workspace"));
  const rt = new NoneRuntime({
    type: "none",
    workspaceDir: path.join(root, "workspace"),
    env: { HOME: home },
  });
  await rt.create();
  return {
    root,
    home,
    rt,
    cleanup: async () => {
      await rt.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
async function file(p: string, data: string) {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, data);
  return p;
}
for (const edition of ["global", "cn"])
  test(`Qoder ${edition} assembles actual session files, usage high water and detached artifacts`, async () => {
    const s = await setup();
    try {
      const key = canonicalWorkspaceKey(s.rt.workspace());
      await file(
        path.join(
          s.home,
          edition === "cn" ? ".qoder-cn" : ".qoder",
          "projects",
          key,
          "saved-id.jsonl",
        ),
        jsonl(
          { type: "user", message: { role: "user", content: "question" } },
          {
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "session final" }],
              usage: { input_tokens: 40, output_tokens: 12 },
            },
          },
        ),
      );
      const a = new QoderCLIAgent({ name: "qodercli", kwargs: { edition } });
      const result = await a.buildSessionResult(
        s.rt,
        { signal: AbortSignal.abort() },
        "question",
        performance.now(),
        {
          stdout: JSON.stringify({
            type: "result",
            result: "stdout final",
            usage: { input_tokens: 50, output_tokens: 4 },
          }),
          stderr: "process failed",
          exitCode: 2,
        },
      );
      assert.equal(result.session_id, "saved-id");
      assert.equal(result.final_message, "session final");
      assert.equal(result.input_tokens, 50);
      assert.equal(result.output_tokens, 12);
      assert.equal(result.exit_code, 2);
      assert.equal(result.artifacts?.generated_files?.length, 2);
      assert.match(
        await readFile(
          path.resolve(
            s.rt.workspace(),
            result.artifacts!.generated_files![0]!,
          ),
          "utf8",
        ),
        /stdout final/,
      );
    } finally {
      await s.cleanup();
    }
  });
for (const engine of ["qodercli", "qwen_code"])
  test(`${engine} preserves actual stdout fallback and artifact-directory registration`, async () => {
    const s = await setup();
    try {
      const a =
        engine === "qodercli"
          ? new QoderCLIAgent({ name: engine })
          : new QwenCodeAgent({ name: engine });
      const artifacts = path.join(s.root, "artifacts");
      const result = await a.buildSessionResult(
        s.rt,
        { artifactDir: artifacts },
        "question",
        performance.now(),
        { stdout: "  fallback final \n", stderr: "", exitCode: 0 },
      );
      assert.equal(result.final_message, "fallback final");
      assert.deepEqual(result.transcript, [
        { role: "user", content: "question", turn: 1 },
        { role: "assistant", content: "fallback final", turn: 1 },
      ]);
      assert.deepEqual(result.artifacts?.generated_files, []);
      assert.equal(
        await readFile(
          path.join(
            artifacts,
            engine === "qodercli" ? "stdout.json" : "stdout.txt",
          ),
          "utf8",
        ),
        "  fallback final \n",
      );
    } finally {
      await s.cleanup();
    }
  });
test("Qwen actual chat transcript overrides stdout while preserving token counts", async () => {
  const s = await setup();
  try {
    await file(
      path.join(
        s.home,
        ".qwen",
        "projects",
        canonicalWorkspaceKey(s.rt.workspace()),
        "chats",
        "session.jsonl",
      ),
      jsonl(
        { type: "user", message: { role: "user", parts: [{ text: "hello" }] } },
        {
          type: "assistant",
          message: {
            role: "model",
            parts: [
              { text: "private", thought: true },
              { text: "session final" },
            ],
          },
          usageMetadata: {
            promptTokenCount: 12,
            candidatesTokenCount: 2,
            thoughtsTokenCount: 4,
          },
        },
      ),
    );
    const result = await new QwenCodeAgent({
      name: "qwen_code",
    }).buildSessionResult(
      s.rt,
      { signal: AbortSignal.abort() },
      "hello",
      performance.now(),
      { stdout: "wrong stdout", stderr: "", exitCode: 0 },
    );
    assert.equal(result.final_message, "session final");
    assert.equal(result.input_tokens, 12);
    assert.equal(result.output_tokens, 6);
    assert.equal(result.transcript?.length, 2);
  } finally {
    await s.cleanup();
  }
});
for (const sessionFinal of ["", "session final"])
  test(`Codex longer actual session ${sessionFinal ? "replaces" : "does not discard"} valid stream final`, async () => {
    const s = await setup();
    try {
      const paths = await prepareCodexRunArtifacts(s.rt);
      await writeFile(
        paths.stdoutPath,
        jsonl(
          { type: "thread.started", thread_id: "saved-session" },
          {
            type: "item.completed",
            item: { type: "agent_message", text: "stream final" },
          },
        ),
      );
      await file(
        path.join(s.home, ".codex", "sessions", "rollout-saved-session.jsonl"),
        jsonl(
          {
            type: "response_item",
            payload: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "hello" }],
            },
          },
          {
            type: "response_item",
            payload: {
              type: "function_call",
              name: "shell",
              call_id: "c",
              arguments: "{}",
            },
          },
          ...(sessionFinal
            ? [
                {
                  type: "event_msg",
                  payload: { type: "agent_message", message: sessionFinal },
                },
              ]
            : []),
        ),
      );
      const result = await new CodexAgent({ name: "codex" }).buildSessionResult(
        s.rt,
        {},
        "hello",
        performance.now(),
        { stdout: "", stderr: "", exitCode: 0 },
        paths.dir,
        paths.lastMessagePath,
        paths.stdoutPath,
      );
      assert.equal(result.error, undefined);
      assert.equal(result.result.final_message, sessionFinal || "stream final");
    } finally {
      await s.cleanup();
    }
  });
test("typed JSON null array entries preserve adjacent valid content as Go zero-valued structs do", async () => {
  const s = await setup();
  try {
    const { parseCodexSessionFile } = await import("../../src/agent/codex.js");
    const { parseQwenSessionFile } =
      await import("../../src/agent/qwen-code.js");
    const c = await file(
      path.join(s.root, "codex.jsonl"),
      jsonl({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [null, { type: "output_text", text: "codex final" }],
        },
      }),
    );
    assert.equal((await parseCodexSessionFile(c)).finalMsg, "codex final");
    const q = await file(
      path.join(s.root, "qwen.jsonl"),
      jsonl({
        type: "assistant",
        message: { role: "model", parts: [null, { text: "qwen final" }] },
      }),
    );
    assert.equal((await parseQwenSessionFile(q)).finalMsg, "qwen final");
  } finally {
    await s.cleanup();
  }
});
