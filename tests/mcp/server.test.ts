import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const bootstrap = path.join(root, "dist/src/bootstrap.js");
async function setup(
  t: test.TestContext,
  allowExecution = false,
  extraEnv: Record<string, string> = {},
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skilled-mcp-server-"));
  const workspace = path.join(dir, "workspace");
  await mkdir(workspace);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      bootstrap,
      "mcp",
      "--workspace",
      workspace,
      ...(allowExecution ? ["--allow-execution"] : []),
    ],
    cwd: workspace,
    env: {
      PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
      HOME: dir,
      USERPROFILE: dir,
      OTEL_TRACES_EXPORTER: "none",
      OTEL_METRICS_EXPORTER: "none",
      NO_COLOR: "1",
      ...extraEnv,
    },
    stderr: "pipe",
  });
  const client = new Client({
    name: "skilled-real-mcp-client",
    version: "1.0.0",
  });
  const protocolErrors: string[] = [];
  client.onerror = (error) => {
    protocolErrors.push(error.message);
  };
  let stderr = "";
  transport.stderr?.on("data", (data: Buffer) => {
    stderr += data.toString();
  });
  t.after(async () => {
    await client.close();
    await rm(dir, { recursive: true, force: true });
  });
  await client.connect(transport);
  return { dir, workspace, client, protocolErrors, stderr: () => stderr };
}
function text(result: Record<string, unknown>): string {
  const parts = result.content as { type: string; text?: string }[];
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
async function fixture(workspace: string, passing = true, delayPid?: string) {
  const skill = path.join(workspace, "hash-skill");
  await mkdir(path.join(skill, "evals/cases"), { recursive: true });
  await writeFile(
    path.join(skill, "SKILL.md"),
    "---\nname: hash-skill\ndescription: Compute actual SHA256 digests for supplied text.\n---\nHash the user's input.\n",
  );
  let worker = await readFile(
    path.join(root, "tests/integration/phase3/worker.cjs"),
    "utf8",
  );
  if (delayPid)
    worker = `require('node:fs').writeFileSync(${JSON.stringify(delayPid)}, String(process.pid));\nsetTimeout(() => {\n${worker}\n}, 30000);\n`;
  await writeFile(
    path.join(skill, "evals/eval.yaml"),
    JSON.stringify({
      schema_version: "v1alpha1",
      environment: { type: "none" },
      engine: {
        name: "hash-worker",
        custom: {
          transport: "local",
          response_format: "session_result",
          local: {
            command: process.execPath,
            args: ["engine.cjs", "${input_file}"],
          },
        },
      },
      cases: { files: ["evals/cases/hash.yaml"], parallelism: 1 },
      judge: {
        type: "rule_based",
        success: [
          {
            output_contains: {
              all: [
                passing
                  ? createHash("sha256")
                      .update("actual MCP input")
                      .digest("hex")
                  : "unexpected text",
              ],
            },
          },
        ],
      },
      report: { formats: ["json"], artifacts: ["transcript"] },
    }),
  );
  await writeFile(
    path.join(skill, "evals/cases/hash.yaml"),
    JSON.stringify({
      id: "actual-hash",
      title: "Actual hash",
      input: { prompt: "actual MCP input" },
      context: { files: { "engine.cjs": worker } },
      constraints: { timeout_seconds: 60, max_turns: 1 },
    }),
  );
  return "hash-skill";
}
async function resultFile(directory: string): Promise<string> {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isFile() && item.name === "result.json") return file;
    if (item.isDirectory())
      try {
        return await resultFile(file);
      } catch {}
  }
  throw new Error("No generated result.json found");
}
async function waitForFile(file: string): Promise<number> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      return Number(await readFile(file, "utf8"));
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Real worker did not start");
}
async function waitForExit(pid: number) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Worker ${pid} survived cancellation`);
}
test("CLI MCP stdio discovers real workflow, reference resources, templates and prompt", async (t) => {
  const { client, protocolErrors } = await setup(t, false, {
    OTEL_METRICS_EXPORTER: "console",
    OTEL_METRIC_EXPORT_INTERVAL: "10",
  });
  assert.deepEqual(
    (await client.listTools()).tools.map((tool) => tool.name).sort(),
    [
      "skilled_compare",
      "skilled_run",
      "skilled_validate",
      "skilled_validate_skill",
    ],
  );
  const resources = await client.listResources();
  for (const suffix of [
    "",
    "/references/case-yaml.md",
    "/references/install.md",
    "/assets/eval.yaml.tmpl",
  ]) {
    const uri = `skilled://workflow/skilled-improve${suffix}`;
    assert.ok(resources.resources.some((resource) => resource.uri === uri));
    const resource = await client.readResource({ uri });
    const source = await readFile(
      path.join(
        root,
        "skills/skilled-improve",
        suffix ? suffix.slice(1) : "SKILL.md",
      ),
      "utf8",
    );
    assert.ok("text" in resource.contents[0]);
    assert.equal(resource.contents[0].text, source);
  }
  assert.equal((await client.listPrompts()).prompts[0].name, "skilled-improve");
  const prompt = await client.getPrompt({ name: "skilled-improve" });
  assert.equal(prompt.messages[0].content.type, "text");
  if (prompt.messages[0].content.type === "text")
    assert.match(prompt.messages[0].content.text, /MCP usage:.*references/s);
  await assert.rejects(
    client.readResource({
      uri: "skilled://workflow/skilled-improve/../package.json",
    }),
  );
  assert.deepEqual(protocolErrors, []);
});
test("MCP validates actual source and eval files, defaults to dry-run, and requires execution opt-in", async (t) => {
  const { client, workspace } = await setup(t);
  const skill = await fixture(workspace);
  const validated = await client.callTool({
    name: "skilled_validate_skill",
    arguments: { path: skill },
  });
  assert.equal(validated.isError, false, text(validated));
  assert.equal(JSON.parse(text(validated)).valid, true);
  const evaluation = await client.callTool({
    name: "skilled_validate",
    arguments: { path: skill },
  });
  assert.equal(evaluation.isError, false, text(evaluation));
  assert.deepEqual(JSON.parse(text(evaluation)).cases, ["actual-hash"]);
  const dry = await client.callTool({
    name: "skilled_run",
    arguments: { path: skill },
  });
  assert.equal(JSON.parse(text(dry)).dryRun, true);
  assert.deepEqual(await readdir(workspace), ["hash-skill"]);
  const denied = await client.callTool({
    name: "skilled_run",
    arguments: { path: skill, dryRun: false },
  });
  assert.equal(denied.isError, true);
  assert.match(text(denied), /--allow-execution/);
  await writeFile(path.join(workspace, skill, "evals/eval.yaml"), "invalid: [");
  assert.equal(
    (
      await client.callTool({
        name: "skilled_validate",
        arguments: { path: skill },
      })
    ).isError,
    true,
  );
});
test("MCP rejects traversal, external symlinks, escaping case files and invalid tool arguments", async (t) => {
  const { client, workspace, dir } = await setup(t);
  await writeFile(path.join(dir, "outside.json"), "{}");
  await symlink(
    path.join(dir, "outside.json"),
    path.join(workspace, "escape.json"),
  );
  for (const before of ["../outside.json", "escape.json"]) {
    const result = await client.callTool({
      name: "skilled_compare",
      arguments: { before, after: before },
    });
    assert.equal(result.isError, true);
    assert.match(text(result), /outside|inside/);
  }
  for (const args of [
    { path: ".", timeoutSeconds: 0 },
    { path: ".", dryRun: "false" },
    { path: ".", extra: true },
    { path: ".", constructor: true },
  ]) {
    assert.equal(
      (await client.callTool({ name: "skilled_run", arguments: args })).isError,
      true,
    );
  }
  const skill = await fixture(workspace);
  const configFile = path.join(workspace, skill, "evals/eval.yaml");
  const config = JSON.parse(await readFile(configFile, "utf8"));
  config.cases.files = ["../../outside.json"];
  await writeFile(configFile, JSON.stringify(config));
  const result = await client.callTool({
    name: "skilled_validate",
    arguments: { path: skill },
  });
  assert.equal(result.isError, true);
  assert.match(text(result), /inside|outside/);
});
test(
  "MCP executes the real hash engine twice and compares its actual PASS and FAIL reports",
  { timeout: 60000 },
  async (t) => {
    const { client, workspace } = await setup(t, true);
    const skill = await fixture(workspace);
    const before = await client.callTool({
      name: "skilled_run",
      arguments: {
        path: skill,
        dryRun: false,
        outputDir: "runs/before",
        timeoutSeconds: 30,
      },
    });
    assert.equal(before.isError, false, text(before));
    assert.equal(JSON.parse(text(before)).exitCode, 0);
    await fixture(workspace, false);
    const after = await client.callTool({
      name: "skilled_run",
      arguments: {
        path: skill,
        dryRun: false,
        outputDir: "runs/after",
        timeoutSeconds: 30,
      },
    });
    assert.equal(after.isError, true, text(after));
    const beforePath = await resultFile(path.join(workspace, "runs/before"));
    const afterPath = await resultFile(path.join(workspace, "runs/after"));
    const compared = await client.callTool({
      name: "skilled_compare",
      arguments: { before: beforePath, after: afterPath },
    });
    assert.equal(compared.isError, false, text(compared));
    const comparison = JSON.parse(text(compared));
    assert.equal(comparison.summary.matched, 1);
    assert.equal(comparison.summary.regressions, 1);
    assert.equal(comparison.hasRegressions, true);
  },
);
test(
  "MCP client cancellation terminates the actual evaluation worker and keeps the server usable",
  { timeout: 45000 },
  async (t) => {
    const { client, workspace, dir } = await setup(t, true);
    const pidFile = path.join(dir, "worker.pid");
    const skill = await fixture(workspace, true, pidFile);
    const controller = new AbortController();
    const pending = client.callTool(
      {
        name: "skilled_run",
        arguments: { path: skill, dryRun: false, timeoutSeconds: 60 },
      },
      undefined,
      { signal: controller.signal },
    );
    // Attach immediately so a startup error cannot produce an unhandled rejection.
    const cancelled = assert.rejects(pending, /cancel|abort/i);
    const pid = await waitForFile(pidFile);
    controller.abort(new Error("client cancellation"));
    await cancelled;
    await waitForExit(pid);
    assert.equal((await client.listTools()).tools.length, 4);
  },
);
test(
  "MCP time limit terminates the actual worker and returns a bounded error",
  { timeout: 45000 },
  async (t) => {
    const { client, workspace, dir } = await setup(t, true);
    const pidFile = path.join(dir, "timeout-worker.pid");
    const skill = await fixture(workspace, true, pidFile);
    const pending = client.callTool({
      name: "skilled_run",
      arguments: { path: skill, dryRun: false, timeoutSeconds: 3 },
    });
    const pid = await waitForFile(pidFile);
    const result = await pending;
    assert.equal(result.isError, true);
    assert.match(text(result), /time limit/);
    assert.ok(Buffer.byteLength(text(result)) < 65536);
    await waitForExit(pid);
  },
);

test("MCP bounds real large metadata responses and rejects oversized report files", async (t) => {
  const { client, workspace } = await setup(t);
  const skill = await fixture(workspace);
  await writeFile(
    path.join(workspace, skill, "SKILL.md"),
    `---\nname: hash-skill\ndescription: ${"🧪".repeat(20000)}\n---\nCompute a digest.\n`,
  );
  const result = await client.callTool({
    name: "skilled_validate_skill",
    arguments: { path: skill },
  });
  assert.equal(result.isError, false);
  assert.ok(Buffer.byteLength(text(result)) <= 65536);
  assert.match(text(result), /Response truncated/);
  await writeFile(
    path.join(workspace, "large.json"),
    Buffer.alloc(4 * 1024 * 1024 + 1, 32),
  );
  const compared = await client.callTool({
    name: "skilled_compare",
    arguments: { before: "large.json", after: "large.json" },
  });
  assert.equal(compared.isError, true);
  assert.match(text(compared), /4 MiB/);
});
