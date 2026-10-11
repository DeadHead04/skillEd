import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Provisioner } from "../../src/mcp/index.js";
import type { MCPServer } from "../../src/contracts/schema.js";
import { filesystemService } from "./filesystem-service.js";
const config = (value: Partial<MCPServer>): MCPServer => ({
  name: "filesystem",
  mode: "real",
  transport: "",
  command: "",
  args: [],
  endpoint: "",
  config_ref: "",
  ...value,
});
async function directory(t: test.TestContext) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skilled-mcp-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
test("real MCP stdio provisioned from YAML writes and reads actual files", async (t) => {
  const root = await directory(t),
    service = fileURLToPath(
      new URL("./filesystem-service.js", import.meta.url),
    );
  await writeFile(
    path.join(root, "server.yaml"),
    `transport: stdio\ncommand: ${JSON.stringify(process.execPath)}\nargs: ${JSON.stringify([service])}\nenv:\n  SKILLED_MCP_ROOT: \${WORKSPACE}\nrequired_env: [WORKSPACE]\n`,
  );
  const { config: cfg, runEnv } = await new Provisioner(root, (key) =>
    key === "WORKSPACE" ? root : undefined,
  ).provision({
    servers: [
      config({
        args: undefined as unknown as string[],
        config_ref: "server.yaml",
      }),
    ],
  });
  assert.equal(runEnv.SKILLED_MCP_ROOT, root);
  const server = cfg.servers[0]!,
    client = new Client({ name: "skilled-test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: server.command!,
      args: server.args,
      env: { ...(process.env as Record<string, string>), ...server.env },
      stderr: "pipe",
    }),
  );
  t.after(() => client.close());
  assert.equal((await client.listTools()).tools.length, 2);
  const content = "actual disk " + randomUUID();
  await client.callTool({
    name: "write_file",
    arguments: { path: "nested/result.txt", content },
  });
  assert.equal(
    await readFile(path.join(root, "nested/result.txt"), "utf8"),
    content,
  );
  const read = await client.callTool({
    name: "read_file",
    arguments: { path: "nested/result.txt" },
  });
  assert.deepEqual(read.content, [{ type: "text", text: content }]);
});
test("real MCP HTTP provision preserves auth references and transfers actual file content", async (t) => {
  const root = await directory(t),
    token = randomUUID();
  const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    }),
    service = filesystemService(root);
  await service.connect(transport);
  const server = createServer((req, res) => {
    if (req.headers.authorization !== "Bearer " + token) {
      res.writeHead(401);
      res.end();
      return;
    }
    void transport.handleRequest(req, res).catch((e) => {
      if (!res.headersSent) res.writeHead(500);
      res.end(String(e));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await service.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}/mcp`;
  await writeFile(
    path.join(root, "http.yaml"),
    'transport: streamable_http\nendpoint: ${ENDPOINT}\nheaders:\n  Authorization: "Bearer ${TOKEN}"\n',
  );
  const env = { ENDPOINT: endpoint, TOKEN: token };
  const { config: cfg, runEnv } = await new Provisioner(
    root,
    (k) => env[k as keyof typeof env],
  ).provision({ servers: [config({ config_ref: "http.yaml" })] });
  assert.equal(cfg.servers[0]!.endpoint, "${ENDPOINT}");
  assert.equal(cfg.servers[0]!.headers!.Authorization, "Bearer ${TOKEN}");
  assert.equal(runEnv.TOKEN, token);
  const client = new Client({ name: "skilled-http", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(runEnv.ENDPOINT!), {
      requestInit: { headers: { Authorization: "Bearer " + runEnv.TOKEN } },
    }),
  );
  t.after(() => client.close());
  const content = "HTTP filesystem " + randomUUID();
  await client.callTool({
    name: "write_file",
    arguments: { path: "http.txt", content },
  });
  assert.equal(await readFile(path.join(root, "http.txt"), "utf8"), content);
  assert.deepEqual(
    (
      await client.callTool({
        name: "read_file",
        arguments: { path: "http.txt" },
      })
    ).content,
    [{ type: "text", text: content }],
  );
});
test("product built-in mocked MCP mode runs its real filesystem sandbox and denies escape (not external MCP acceptance)", async (t) => {
  const root = await directory(t),
    outside = await directory(t);
  await writeFile(path.join(outside, "secret"), "outside");
  await symlink(outside, path.join(root, "escape"));
  const { config: cfg } = await new Provisioner(root).provision({
    servers: [config({ mode: "mocked" })],
  });
  const s = cfg.servers[0]!,
    client = new Client({ name: "skilled-fixture-feature", version: "1" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: s.args,
      cwd: root,
      stderr: "pipe",
    }),
  );
  t.after(() => client.close());
  await client.callTool({
    name: "write_file",
    arguments: { path: "result.txt", content: "disk" },
  });
  assert.equal(await readFile(path.join(root, "result.txt"), "utf8"), "disk");
  await assert.rejects(
    client.callTool({
      name: "read_file",
      arguments: { path: "escape/secret" },
    }),
    /outside workspace/,
  );
  await assert.rejects(
    client.callTool({
      name: "write_file",
      arguments: { path: "../bad", content: "no" },
    }),
    /outside workspace/,
  );
});
test("MCP missing credentials and incompatible modes fail before launch", async (t) => {
  const root = await directory(t);
  await writeFile(
    path.join(root, "server.yaml"),
    "endpoint: https://example.invalid/mcp\nrequired_env: [MISSING]\n",
  );
  await assert.rejects(
    new Provisioner(root, () => undefined).provision({
      servers: [config({ config_ref: "server.yaml" })],
    }),
    /required environment variable MISSING/,
  );
  await assert.rejects(
    new Provisioner(root).provision({
      servers: [config({ mode: "mocked", endpoint: "http://localhost" })],
    }),
    /does not support endpoint/,
  );
  await assert.rejects(
    new Provisioner(root).provision({ servers: [config({ mode: "" })] }),
    /mode is required/,
  );
});
test("decoded MCP config inherits file args only when field was omitted", async (t) => {
  const { parseCaseConfig } = await import("../../src/config/loader.js");
  const root = await directory(t);
  await writeFile(
    path.join(root, "stdio.yaml"),
    'transport: stdio\ncommand: node\nargs: [worker.js, "two words"]\n',
  );
  for (const explicit of [false, true]) {
    const parsed = parseCaseConfig(
      "mcp:\n  servers:\n    - name: files\n      mode: real\n      config_ref: stdio.yaml\n" +
        (explicit ? "      args: []\n" : ""),
    );
    const { config: cfg } = await new Provisioner(root).provision(parsed.mcp);
    assert.deepEqual(
      cfg.servers[0]!.args,
      explicit ? [] : ["worker.js", "two words"],
    );
  }
});
