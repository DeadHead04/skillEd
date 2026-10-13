import test from "node:test";
import assert from "node:assert/strict";
import { DockerRuntime } from "../../src/runtime/docker.js";
import { CodexAgent } from "../../src/agent/codex.js";
import { QoderCLIAgent } from "../../src/agent/qodercli.js";
import { QwenCodeAgent } from "../../src/agent/qwen-code.js";
const enabled = process.env.SKILLED_ENGINE_INSTALL_INTEGRATION === "1";
for (const [name, make] of [
  ["codex", () => new CodexAgent({ name: "codex" })],
  ["qwen_code", () => new QwenCodeAgent({ name: "qwen_code" })],
  ["qodercli", () => new QoderCLIAgent({ name: "qodercli" })],
  [
    "qodercn",
    () => new QoderCLIAgent({ name: "qodercli", kwargs: { edition: "cn" } }),
  ],
] as const)
  test(
    `official ${name} CLI installs, is detected and reports version in actual disposable Docker runtime`,
    {
      skip:
        name === "qodercn"
          ? process.env.SKILLED_CN_ENGINE_INSTALL_INTEGRATION !== "1"
          : !enabled,
      timeout: 420_000,
    },
    async (t) => {
      const rt = new DockerRuntime({
        type: "docker",
        image: "node:22",
        delete: true,
      });
      try {
        await rt.create(AbortSignal.timeout(60_000));
        const agent = make();
        await agent.install(rt, AbortSignal.timeout(300_000));
        await agent.check(rt, AbortSignal.timeout(30_000));
        const observation = await agent.inspectRuntime(
          rt,
          AbortSignal.timeout(30_000),
        );
        assert.ok(
          observation.version,
          "installed official CLI must report a version",
        );
        if (name === "codex") assert.equal(observation.version, "0.162.1");
        t.diagnostic(
          JSON.stringify({
            engine: name,
            version: observation.version,
            image: "node:22",
            authenticated_model_call: false,
          }),
        );
      } finally {
        await rt.close();
      }
    },
  );
