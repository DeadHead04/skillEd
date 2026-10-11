import test from "node:test";
import assert from "node:assert/strict";
import { NoneRuntime, DockerRuntime } from "../../src/runtime/index.js";
import { OpenCodeAgent, openCodeMCPServer } from "../../src/agent/opencode.js";
test("OpenCode merges real runtime config and keeps credentials out of inline JSON", async (t) => {
  const rt = new NoneRuntime({
    type: "none",
    delete: true,
    env: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        theme: "dark",
        mcp: { existing: { type: "local", command: ["node", "old.js"] } },
      }),
    },
  });
  await rt.create();
  t.after(() => rt.close());
  const agent = new OpenCodeAgent({
    name: "opencode",
    modelProvider: "custom",
    protocol: "openai",
    modelName: "test-model",
    apiKey: "secret-value",
    baseURL: "http://127.0.0.1:9999",
  });
  await agent.installMCP(rt, {
    servers: [
      {
        name: "files",
        transport: "http",
        endpoint: "http://127.0.0.1:9090/${PATH_TOKEN}",
        env: { PATH_TOKEN: "sensitive-path" },
        headers: { Authorization: "Bearer ${PATH_TOKEN}" },
      },
    ],
  });
  const actual = await rt.exec(`printf '%s' "$OPENCODE_CONFIG_CONTENT"`);
  const cfg = JSON.parse(actual.stdout);
  assert.equal(cfg.theme, "dark");
  assert.ok(cfg.mcp.existing);
  assert.equal(
    cfg.mcp.files.url,
    "http://127.0.0.1:9090/{env:SKILLED_OPENCODE_MCP_0_PATH_TOKEN}",
  );
  assert.equal(
    cfg.provider.custom.options.apiKey,
    "{env:SKILLED_OPENCODE_API_KEY}",
  );
  assert.ok(!actual.stdout.includes("secret-value"));
  assert.ok(!actual.stdout.includes("sensitive-path"));
  assert.equal(
    (await rt.exec(`printf '%s' "$SKILLED_OPENCODE_API_KEY"`)).stdout,
    "secret-value",
  );
});
test("OpenCode rejects invalid MCP environment names and preserves stdio argument boundaries", () => {
  assert.throws(
    () =>
      openCodeMCPServer(
        {
          name: "x",
          transport: "stdio",
          command: "node",
          env: { "bad-name": "x" },
        },
        0,
      ),
    /invalid/,
  );
  assert.deepEqual(
    openCodeMCPServer(
      {
        name: "x",
        transport: "stdio",
        command: "node",
        args: ["two words"],
        env: { TOKEN: "value" },
      },
      2,
    ),
    {
      entry: {
        type: "local",
        command: ["node", "two words"],
        environment: { TOKEN: "{env:SKILLED_OPENCODE_MCP_2_TOKEN}" },
      },
      env: { SKILLED_OPENCODE_MCP_2_TOKEN: "value" },
    },
  );
});
test(
  "real OpenCode Docker install and static preflight",
  {
    skip: process.env.SKILLED_ENGINE_INSTALL_INTEGRATION !== "1",
    timeout: 600_000,
  },
  async (t) => {
    const rt = new DockerRuntime({
      type: "docker",
      image: process.env.SKILLED_ENGINE_TEST_IMAGE || "node:22",
      delete: true,
    });
    await rt.create(AbortSignal.timeout(120_000));
    t.after(() => rt.close());
    const agent = new OpenCodeAgent({ name: "opencode" }),
      signal = AbortSignal.timeout(480_000);
    await agent.install(rt, signal);
    await agent.check(rt, signal);
    const observed = await agent.inspectRuntime(rt, signal);
    assert.ok(observed.version);
    t.diagnostic("Actual OpenCode version " + observed.version);
    await agent.installMCP(
      rt,
      {
        servers: [
          {
            name: "files",
            transport: "stdio",
            command: "npx",
            args: [
              "-y",
              "@modelcontextprotocol/server-filesystem",
              rt.workspace(),
            ],
          },
        ],
      },
      signal,
    );
    const config = await rt.exec(`printf '%s' "$OPENCODE_CONFIG_CONTENT"`, {
      signal,
    });
    assert.equal(JSON.parse(config.stdout).mcp.files.type, "local");
  },
);
