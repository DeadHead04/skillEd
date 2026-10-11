import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import path from "node:path";
import os from "node:os";
import { setOutput, setVerbosity } from "../../src/logging/index.js";
import {
  QoderCLIAgent,
  qoderProfileForKwargs,
  defaultQoderCLIInstallCmdForProfile,
  buildQoderRunCmdForBinary,
  buildQoderResumeCmdForBinary,
  buildQoderRunStdinCmdForBinary,
  parseQoderSessionID,
  buildQoderMCPInstallCmdForBinary,
} from "../../src/agent/qodercli.js";
test("Qoder global/CN profiles and ignored version retain upstream behavior", () => {
  const global = qoderProfileForKwargs(),
    cn = qoderProfileForKwargs({ edition: " CN " });
  assert.equal(global.binary, "qodercli");
  assert.equal(cn.binary, "qodercn");
  assert.equal(cn.credentialEnv, "QODERCN_PERSONAL_ACCESS_TOKEN");
  assert.match(cn.execPathProbe, /\.qoder-cn\/entry/);
  const agent = new QoderCLIAgent({
    name: "",
    version: "9.9.9",
    kwargs: { edition: "cn" },
  });
  assert.equal(agent.cfg.version, "");
  assert.equal(agent.cfg.checkCmd, "command -v qodercn");
  assert.equal(agent.cfg.skillPath, ".qoder/skills");
  assert.match(
    defaultQoderCLIInstallCmdForProfile(cn),
    /https:\/\/static.qoder.com.cn\/qoder-cli-cn\/install.sh/,
  );
});
test("Qoder commands always clear SDK marker and preserve opaque model and resume ID", () => {
  for (const binary of ["qodercli", "qodercn"]) {
    const run = buildQoderRunCmdForBinary(
      binary,
      "user's prompt",
      "vendor/opaque:model",
    );
    assert.ok(run.startsWith("env -u QODER_AGENT_SDK_ENTRYPOINT " + binary));
    assert.match(run, /--output-format json/);
    assert.ok(run.includes("--model 'vendor/opaque:model'"));
    assert.ok(run.endsWith("-p 'user'\\''s prompt'"));
    const resume = buildQoderResumeCmdForBinary(
      binary,
      "continue",
      "m",
      "session",
    );
    assert.match(resume, /-r 'session' -p 'continue'/);
    assert.match(
      buildQoderRunStdinCmdForBinary(binary, "file", "m"),
      /^cat 'file' \| env -u QODER_AGENT_SDK_ENTRYPOINT/,
    );
  }
});
test("Qoder runtime credential overlay and token exposure defaults preserve explicit empty override", () => {
  const agent = new QoderCLIAgent({
    name: "qodercli",
    kwargs: { edition: "cn" },
    modelName: " opaque/model ",
    envVars: {
      QODERCN_EXPOSE_TOKEN_USAGE: "",
      QODERCN_PERSONAL_ACCESS_TOKEN: "test-only-value",
    },
  });
  assert.equal(agent.appliedModelName(), "opaque/model");
  assert.equal(agent.qoderRunEnvVars().QODERCN_EXPOSE_TOKEN_USAGE, "");
  assert.equal(
    new QoderCLIAgent({ name: "qodercli" }).qoderRunEnvVars()
      .QODER_EXPOSE_TOKEN_USAGE,
    "true",
  );
});
test("Qoder credential status writes presence without secrets to actual file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skilled-qoder-log-"));
  try {
    const log = path.join(root, "log"),
      writer = createWriteStream(log),
      restore = setOutput(writer);
    setVerbosity(1);
    try {
      await new QoderCLIAgent({
        name: "qodercli",
        envVars: { QODER_PERSONAL_ACCESS_TOKEN: "test-value-not-to-log" },
      }).checkCredentials();
    } finally {
      restore();
      setVerbosity(0);
      writer.end();
      await finished(writer);
    }
    const text = await readFile(log, "utf8");
    assert.match(text, /source=runtime_env/);
    assert.doesNotMatch(text, /test-value-not-to-log/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("Qoder JSON session identification accepts only string ID in a single envelope", () => {
  assert.equal(parseQoderSessionID('{"session_id":"abc"}'), "abc");
  for (const value of [
    "plain",
    '{"session_id":42}',
    '{"session_id":"a"}\n{}',
    "[]",
    "null",
  ])
    assert.equal(parseQoderSessionID(value), "");
});
test("Qoder MCP constructor routes selected edition and retains secure header expansion", () => {
  const cmd = buildQoderMCPInstallCmdForBinary("qodercn", {
    name: "service",
    transport: "http",
    endpoint: "https://example.invalid",
    headers: { Authorization: "Bearer ${TOKEN}" },
  });
  assert.ok(cmd.includes("env -u QODER_AGENT_SDK_ENTRYPOINT qodercn mcp"));
  assert.ok(cmd.includes("$"));
});
