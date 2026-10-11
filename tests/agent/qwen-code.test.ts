import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  QwenCodeAgent,
  buildQwenCodeRunCmd,
  buildQwenCodeRunStdinCmd,
  defaultQwenCodeInstallCmdForVersion,
  parseQwenSessionFile,
  parseQwenSessionOutput,
  buildQwenCodeMCPInstallCmd,
} from "../../src/agent/qwen-code.js";
test("Qwen defaults, versioned install and stdin command match source", () => {
  const agent = new QwenCodeAgent({ name: "" });
  assert.equal(agent.name(), "qwen_code");
  assert.equal(agent.cfg.skillPath, ".qwen/skills");
  assert.match(
    defaultQwenCodeInstallCmdForVersion("0.20.1"),
    /npm install -g '@qwen-code\/qwen-code@0.20.1'/,
  );
  assert.match(defaultQwenCodeInstallCmdForVersion(""), /command -v qwen/);
  assert.equal(
    buildQwenCodeRunCmd("-leading flag", "model"),
    "printf '%s' '-leading flag' | qwen --yolo -m 'model'",
  );
  assert.equal(
    buildQwenCodeRunStdinCmd("file", ""),
    "cat 'file' | qwen --yolo",
  );
});
test("Qwen actual session JSONL excludes hidden thoughts, preserves tools, final response and token high water", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skilled-qwen-"));
  try {
    const file = path.join(dir, "chat.jsonl");
    await writeFile(
      file,
      [
        { type: "user", message: { role: "user", parts: [{ text: "hello" }] } },
        {
          type: "assistant",
          message: {
            role: "model",
            parts: [
              { text: "hidden reasoning", thought: true },
              {
                functionCall: {
                  id: "tool-1",
                  name: "read_file",
                  args: { path: "README" },
                },
              },
              {
                functionResponse: {
                  id: "tool-1",
                  response: { output: "text" },
                },
              },
              { text: "part one" },
              { text: "part two" },
            ],
          },
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 4,
            thoughtsTokenCount: 3,
            cachedContentTokenCount: 8,
          },
        },
        {
          type: "assistant",
          message: { parts: [{ text: "final" }] },
          usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 },
        },
      ]
        .map((x) => JSON.stringify(x))
        .join("\n"),
    );
    const result = await parseQwenSessionFile(file);
    assert.equal(result.finalMsg, "final");
    assert.equal(result.inputTokens, 10);
    assert.equal(result.outputTokens, 7);
    assert.equal(result.transcript[1].tool_call?.name, "read_file");
    assert.equal(result.transcript[2].tool_result?.status, "success");
    assert.equal(result.transcript[3].content, "part one\n\npart two");
    assert.ok(!JSON.stringify(result).includes("hidden reasoning"));
    assert.deepEqual(
      (await parseQwenSessionFile(path.join(dir, "missing"))).transcript,
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("Qwen parser skips malformed typed fields and keeps prior valid records", () => {
  const good = JSON.stringify({
    type: "assistant",
    message: { parts: [{ text: "good" }] },
  });
  for (const bad of [
    { type: "assistant", message: { parts: "wrong" } },
    { type: "assistant", message: { parts: [{ text: 42 }] } },
    {
      type: "assistant",
      message: { parts: [] },
      usageMetadata: { promptTokenCount: "wrong" },
    },
  ])
    assert.equal(
      parseQwenSessionOutput(good + "\n" + JSON.stringify(bad)).finalMsg,
      "good",
    );
});
test("Qwen MCP builder matches supported transport and rejects missing command", () => {
  assert.match(
    buildQwenCodeMCPInstallCmd({
      name: "mcp",
      transport: "stdio",
      command: "node",
      args: ["mcp.js"],
    }),
    /qwen mcp add/,
  );
  assert.throws(
    () => buildQwenCodeMCPInstallCmd({ name: "mcp", transport: "stdio" }),
    /requires command/,
  );
});
test("Qwen actual file scanner keeps valid prefix and stops at original one MiB record limit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skilled-qwen-limit-"));
  try {
    const file = path.join(root, "session.jsonl");
    await writeFile(
      file,
      [
        JSON.stringify({
          type: "assistant",
          message: { role: "model", parts: [{ text: "before limit" }] },
        }),
        "x".repeat(1024 * 1024),
        JSON.stringify({
          type: "assistant",
          message: { role: "model", parts: [{ text: "must not appear" }] },
        }),
      ].join("\n"),
    );
    const result = await parseQwenSessionFile(file);
    assert.equal(result.finalMsg, "before limit");
    assert.equal(result.transcript.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
