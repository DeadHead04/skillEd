import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { NoneRuntime } from "../../src/runtime/none.js";
import {
  CodexAgent,
  buildCodexRunCmd,
  buildCodexResumeCmdWithLastMessage,
  buildCodexRunStdinCmdWithLastMessage,
  defaultCodexInstallCmdForVersion,
  parseCodexOutput,
  parseCodexOutputFile,
  parseCodexSessionFileWithLimit,
  codexToolResultStatus,
  codexMCPToolResultStatus,
  positiveCodexByteKwarg,
  codexDefaultRecordBytes,
  codexDefaultOutputBytes,
  prepareCodexRunArtifacts,
  cleanupCodexRunArtifacts,
  validCodexRunArtifactDir,
  checkCodexRemoteJSONLSize,
  codexArtifactTransferOptions,
  buildCodexMCPInstallCmd,
} from "../../src/agent/codex.js";
const jsonl = (...records: unknown[]) =>
  records.map((r) => JSON.stringify(r)).join("\n");
test("Codex constructor and provider routing preserve supported configuration", () => {
  const defaults = new CodexAgent({ name: "" });
  assert.equal(defaults.name(), "codex");
  assert.equal(defaults.cfg.skillPath, ".codex/skills");
  assert.deepEqual(defaults.runProviderConfig(), {});
  for (const provider of ["", "openai"]) {
    const agent = new CodexAgent({
      name: "codex",
      modelProvider: provider,
      baseURL: "https://endpoint.invalid/v1",
      modelName: " model ",
    });
    assert.equal(agent.runProviderConfig().name, "skilled-openai");
    assert.equal(agent.appliedModelName(), "model");
  }
  const custom = new CodexAgent({
    name: "codex",
    modelProvider: "vendor-1",
    modelName: "m",
    baseURL: "https://endpoint.invalid",
  });
  assert.equal(custom.runProviderConfig().name, "vendor-1");
  assert.equal(
    new CodexAgent({
      name: "codex",
      modelProvider: "vendor",
      modelName: "m",
    }).appliedModelName(),
    "",
  );
  assert.deepEqual(
    new CodexAgent({
      name: "codex",
      modelProvider: "bad.name",
      baseURL: "x",
    }).runProviderConfig(),
    {},
  );
});
test("Codex command builders preserve pinned installation, prompts, provider flags and resume semantics", () => {
  assert.match(defaultCodexInstallCmdForVersion(""), /@openai\/codex@0\.80\.0/);
  assert.match(
    defaultCodexInstallCmdForVersion("1.2.3"),
    /--include=optional '@openai\/codex@1.2.3'/,
  );
  const p = {
    name: "vendor",
    label: "Vendor",
    baseURL: "https://example.invalid",
    envKey: "OPENAI_API_KEY",
    wireAPI: "chat",
  };
  const run = buildCodexRunCmd(
    "user's request",
    "model",
    p,
    "--sandbox workspace-write",
  );
  assert.match(
    run,
    /codex exec --json --skip-git-repo-check --sandbox workspace-write/,
  );
  assert.ok(run.includes("'user'\\''s request'"));
  assert.ok(run.includes('model_providers.vendor.wire_api="chat"'));
  assert.match(
    buildCodexResumeCmdWithLastMessage("session", "next", "model", p, "last"),
    /^codex exec resume .*--dangerously-bypass-approvals-and-sandbox/,
  );
  assert.match(
    buildCodexRunStdinCmdWithLastMessage("prompt", "m", {}, "", "last"),
    /^cat 'prompt' \| codex exec/,
  );
});
test("Codex parser deduplicates paired tools, preserves turn IDs and accounts token high water", () => {
  const result = parseCodexOutput(
    jsonl(
      { type: "thread.started", thread_id: "thread" },
      { type: "turn.started" },
      {
        type: "item.started",
        item: { id: "cmd", type: "command_execution", command: "pwd" },
      },
      { type: "turn.started" },
      {
        type: "item.completed",
        item: {
          id: "cmd",
          type: "command_execution",
          exit_code: 1,
          aggregated_output: "failed",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "mcp",
          type: "mcp_tool_call",
          server: "server",
          tool: "read",
          arguments: { a: 1 },
          result: { z: "<x>", a: 2 },
          status: "failed",
        },
      },
      { type: "item.completed", item: { type: "agent_message", text: "done" } },
      {
        type: "turn.completed",
        usage: {
          input_tokens: 5,
          cached_input_tokens: 2,
          cache_creation_input_tokens: 3,
          output_tokens: 7,
        },
      },
      { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
    ),
  );
  assert.equal(result.threadID, "thread");
  assert.equal(result.inputTokens, 10);
  assert.equal(result.outputTokens, 7);
  assert.equal(result.transcript[1].turn, 1);
  assert.equal(result.transcript[1].tool_result?.status, "error");
  assert.equal(result.transcript[2].tool_call?.name, "mcp__server__read");
  assert.equal(
    result.transcript[3].tool_result?.content,
    '{"a":2,"z":"\\u003cx\\u003e"}',
  );
  assert.equal(result.finalMsg, "done");
});
test("Codex stdout parses adjacent JSON and keeps valid prefix before malformed data or record limits", () => {
  const one = JSON.stringify({ type: "thread.started", thread_id: "a" }),
    two = JSON.stringify({ type: "turn.started" });
  assert.equal(parseCodexOutput(one + two).threadID, "a");
  assert.equal(parseCodexOutput(one + "broken" + two).threadID, "a");
  const limited = parseCodexOutput(one + "\n" + "x".repeat(200), 100);
  assert.match(limited.error!.message, /record 2 exceeds/);
  assert.equal(limited.threadID, "a");
  assert.match(parseCodexOutput("x", 0).error!.message, /positive/);
  assert.equal(parseCodexOutput(one + "null" + two).threadID, "a");
});
test("Codex size kwargs and result-status parsing preserve source distinctions", () => {
  assert.equal(positiveCodexByteKwarg({}, "bytes", 12), 12);
  for (const bad of ["0", "-1", "1.5", "oops"])
    assert.equal(positiveCodexByteKwarg({ bytes: bad }, "bytes", 12), 12);
  assert.equal(positiveCodexByteKwarg({ bytes: " +32 " }, "bytes", 12), 32);
  assert.deepEqual(new CodexAgent({ name: "codex" }).jsonlLimits(), {
    recordBytes: codexDefaultRecordBytes,
    outputBytes: codexDefaultOutputBytes,
  });
  for (const [text, status] of [
    ["nothing", "success"],
    ["Process exited with code 0", "success"],
    ["Process exited with code 12\ntext", "error"],
    ["Process exited with code -1", "success"],
  ])
    assert.equal(codexToolResultStatus(text), status);
  assert.equal(codexMCPToolResultStatus(" Completed "), "success");
  assert.equal(codexMCPToolResultStatus("failed"), "error");
});
test("actual JSONL files retain large final messages, bounded records and read errors", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skilled-codex-parser-"));
  try {
    const file = path.join(dir, "stdout.jsonl");
    const text = "a".repeat(2 << 20);
    await writeFile(
      file,
      jsonl({ type: "item.completed", item: { type: "agent_message", text } }),
    );
    assert.equal(
      (await parseCodexOutputFile(file)).finalMsg.length,
      text.length,
    );
    assert.match(
      (await parseCodexOutputFile(file, 100)).error!.message,
      /record 1/,
    );
    await writeFile(
      file,
      jsonl(
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "hi" }],
          },
        },
        {
          type: "response_item",
          payload: {
            type: "function_call",
            name: "shell",
            call_id: "call",
            arguments: "{}",
          },
        },
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call",
            output: "Process exited with code 1",
          },
        },
        {
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 2,
                cached_input_tokens: 3,
                cache_creation_input_tokens: 1,
                output_tokens: 4,
              },
            },
          },
        },
        {
          type: "event_msg",
          payload: { type: "agent_message", message: "final" },
        },
      ),
    );
    const parsed = await parseCodexSessionFileWithLimit(file, 1024);
    assert.equal(parsed.finalMsg, "final");
    assert.equal(parsed.inputTokens, 6);
    assert.equal(parsed.transcript[2].tool_result?.status, "error");
    assert.ok((await parseCodexOutputFile(path.join(dir, "missing"))).error);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("actual runtime artifacts survive cancellation, enforce total bytes and preserve final-message override", async () => {
  const rt = new NoneRuntime({
    type: "none",
    delete: true,
    env: { HOME: "/nonexistent/skilled-home" },
  });
  await rt.create();
  try {
    const paths = await prepareCodexRunArtifacts(rt);
    assert.equal(validCodexRunArtifactDir("linux", paths.dir), true);
    assert.equal(validCodexRunArtifactDir("linux", "/tmp/unrelated"), false);
    await writeFile(
      paths.stdoutPath,
      jsonl(
        { type: "thread.started", thread_id: "test-thread" },
        { type: "turn.started" },
        {
          type: "item.completed",
          item: { type: "agent_message", text: "progress" },
        },
      ),
    );
    await writeFile(paths.lastMessagePath, "final answer");
    await assert.rejects(
      checkCodexRemoteJSONLSize(rt, paths.stdoutPath, "Codex stdout", 1),
      /exceeding maximum/,
    );
    const opts = codexArtifactTransferOptions(
      { signal: AbortSignal.abort() },
      256 << 20,
    );
    assert.equal(opts.signal?.aborted, false);
    const agent = new CodexAgent({ name: "codex" });
    const built = await agent.buildSessionResult(
      rt,
      { signal: AbortSignal.abort() },
      "instruction",
      performance.now(),
      { stdout: "", stderr: "failure", exitCode: 1 },
      paths.dir,
      paths.lastMessagePath,
      paths.stdoutPath,
    );
    assert.equal(built.error, undefined);
    assert.equal(built.result.exit_code, 1);
    assert.equal(built.result.final_message, "final answer");
    assert.equal(built.result.transcript?.at(-1)?.content, "final answer");
    assert.equal(
      await readFile(
        path.join(rt.workspace(), ".skilled", "codex-last-message.txt"),
        "utf8",
      ),
      "final answer",
    );
    await assert.rejects(stat(paths.dir));
    await cleanupCodexRunArtifacts(rt, paths.dir);
  } finally {
    await rt.close();
  }
});
test("Codex MCP actual command construction supports stdio and HTTP header bridges", () => {
  assert.equal(
    buildCodexMCPInstallCmd({
      name: "s",
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      env: { TOKEN: "x" },
    }),
    `codex mcp remove 's' >/dev/null 2>&1 || true\ncodex mcp add 's' --env 'TOKEN='"$TOKEN" -- 'node' 'server.js'`,
  );
  const cmd = buildCodexMCPInstallCmd({
    name: "remote",
    transport: "http",
    endpoint: "https://example.invalid",
    headers: { Authorization: "Bearer ${TOKEN}" },
    headerEnv: { Authorization: "TOKEN" },
    env: { TOKEN: "secret" },
  });
  assert.match(cmd, /mcp-remote/);
  assert.ok(!cmd.includes("secret"));
  assert.throws(
    () => buildCodexMCPInstallCmd({ name: "bad", transport: "stdio" }),
    /requires command/,
  );
  assert.throws(
    () => buildCodexMCPInstallCmd({ name: "bad", transport: "sse" }),
    /not supported/,
  );
});
