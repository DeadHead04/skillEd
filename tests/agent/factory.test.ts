import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectAgent,
  detectAgentWithResolvedConfig,
} from "../../src/agent/factory.js";
import { engineKwargBool } from "../../src/agent/kwargs.js";
import { preflight } from "../../src/agent/base.js";
import { resolveAdapterConfig } from "../../src/agent/capabilities.js";
import { resolveRunnerConfig } from "../../src/credentials/index.js";
import { defaultEvalConfig, parseEvalConfig } from "../../src/config/index.js";
import { NoneRuntime } from "../../src/runtime/none.js";
import { findExecutable } from "../../src/platform/index.js";
import { UnsupportedAgentError } from "../../src/agent/errors.js";

test("factory dispatches all source engine aliases and rejects missing custom definitions", () => {
  for (const name of [
    "claude_code",
    "claude-code",
    "codex",
    "opencode",
    "qodercli",
    "qoder",
    "qoder-cli",
    "qwen_code",
    "qwen-code",
    "qwen",
  ])
    assert.equal(detectAgent(name, { name: "" }).name(), name);
  assert.throws(
    () => detectAgent("missing", { name: "" }),
    UnsupportedAgentError,
  );
});
test("source boolean kwarg spellings remain exact", () => {
  for (const value of ["1", "t", "T", "true", "TRUE", "True", " true "])
    assert.equal(engineKwargBool({ flag: value }, "flag"), true);
  for (const value of [
    "0",
    "f",
    "F",
    "false",
    "FALSE",
    "False",
    "tRuE",
    "yes",
    "",
  ])
    assert.equal(engineKwargBool({ flag: value }, "flag"), false);
});
test("Codex login file survives adapter materialization as a path", () => {
  const engine = defaultEvalConfig().engine;
  engine.name = "codex";
  engine.kwargs = { codex_auth_file: "/private/codex/auth.json" };
  const resolved = resolveAdapterConfig(resolveRunnerConfig(engine));
  assert.equal(resolved.kwargs.codex_auth_file, engine.kwargs.codex_auth_file);
  assert.ok(!resolved.warnings.some(value => value.includes("codex_auth_file")));
});
test("configuration materialization precedes agent factory and version warnings retain source behavior", () => {
  const engine = defaultEvalConfig().engine;
  engine.name = "qodercli";
  engine.version = "1.2.3";
  const raw = resolveRunnerConfig(engine);
  assert.throws(() => detectAgentWithResolvedConfig(raw), /not materialized/);
  const resolved = resolveAdapterConfig(raw);
  assert.equal(resolved.appliedVersion, "");
  assert.ok(
    resolved.warnings.some((value) =>
      value.includes("does not support engine.version"),
    ),
  );
  assert.equal(detectAgentWithResolvedConfig(resolved).name(), "qodercli");
});
test("stateful capability is exposed only for the configured custom mode", () => {
  const cfg = parseEvalConfig(
    "engine:\n  name: command-worker\n  custom:\n    transport: local\n    response_format: session_result\n    conversation_mode: batch\n    local:\n      command: /bin/sh\n",
  ).engine.custom!;
  const batch = detectAgent("command-worker", { name: "", custom: cfg });
  assert.equal("runTurn" in batch, false);
  const stateful = detectAgent("command-worker", {
    name: "",
    custom: { ...cfg, conversation_mode: "stateful" },
  });
  assert.equal("runTurn" in stateful, true);
});
for (const [engine, binary] of [
  ["claude_code", "claude"],
  ["codex", "codex"],
])
  test(
    `actual installed ${engine} preflight reads version without a model request`,
    {
      skip: !findExecutable(binary) && "CLI not installed on this host",
      timeout: 30000,
    },
    async () => {
      const home = await mkdtemp(join(tmpdir(), "skilled-preflight-home-"));
      const rt = new NoneRuntime({
        type: "none",
        delete: true,
        env: { HOME: home },
      });
      try {
        await rt.create();
        const result = await preflight(
          rt,
          detectAgent(engine, { name: engine }),
          AbortSignal.timeout(20000),
        );
        assert.match(result.version, /^\d+\.\d+\.\d+/);
      } finally {
        await rt.close();
        await rm(home, { recursive: true, force: true });
      }
    },
  );
