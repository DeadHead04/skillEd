import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NoneRuntime, DockerRuntime } from "../../src/runtime/index.js";
import {
  CLIAgent,
  normalizeVersionOutput,
  normalizedConfiguredVersion,
  checkCommandForOS,
} from "../../src/agent/cli.js";
import {
  ClaudeCodeAgent,
  buildClaudeResumeCmd,
  providerRateLimitText,
  providerAuthFailureText,
} from "../../src/agent/claude-code.js";
import { AgentExecutionError } from "../../src/agent/errors.js";
import { deliverPrompt } from "../../src/agent/prompt-delivery.js";
import { shellExpandedValue } from "../../src/agent/mcp.js";
import { renderGoTemplate } from "../../src/agent/go-template.js";
import { shellQuote } from "../../src/agent/base.js";
async function runtime(t: test.TestContext) {
  const rt = new NoneRuntime({ type: "none", delete: true });
  await rt.create();
  t.after(() => rt.close());
  return rt;
}
test("CLI real shell preserves literal prompts and partial results on nonzero exit and cancellation", async (t) => {
  const rt = await runtime(t),
    agent = new CLIAgent({
      name: "shell",
      runCmd: "printf '%%s' %s; printf problem >&2; exit 7",
    });
  try {
    await agent.run(rt, {}, [
      { role: "user", content: '$(touch forbidden) `false` "quoted"' },
    ]);
    assert.fail("must fail");
  } catch (e) {
    assert.ok(e instanceof AgentExecutionError);
    assert.equal(e.result.exit_code, 7);
    assert.equal(e.result.final_message, '$(touch forbidden) `false` "quoted"');
    assert.equal(e.result.stderr, "problem");
  }
  await assert.rejects(stat(path.join(rt.workspace(), "forbidden")));
  const slow = new CLIAgent({ name: "shell", runCmd: "printf %s; sleep 60" });
  try {
    await slow.run(rt, { timeoutMs: 100 }, [
      { role: "user", content: "partial" },
    ]);
    assert.fail("timeout required");
  } catch (e) {
    assert.ok(e instanceof AgentExecutionError);
    assert.equal(e.result.exit_code, -1);
    assert.equal(e.result.final_message, "partial");
  }
});
test("prompt file delivery executes real stdin and mirrors exact Unicode bytes", async (t) => {
  const rt = await runtime(t),
    artifacts = await mkdtemp(path.join(os.tmpdir(), "skilled-prompts-"));
  t.after(() => rm(artifacts, { recursive: true, force: true }));
  const text = "界🧪\n".repeat(5000) + "$(touch forbidden)";
  const delivery = await deliverPrompt(rt, { artifactDir: artifacts }, text, {
    inline: (p) => "printf %s " + shellQuote(p),
    stdinFile: (p) => "cat " + shellQuote(p),
  });
  assert.equal(delivery.metadata.mode, "file");
  assert.equal((await rt.exec(delivery.command)).stdout, text);
  assert.equal(await readFile(delivery.metadata.prompt_path!, "utf8"), text);
  assert.equal(delivery.metadata.prompt_bytes, Buffer.byteLength(text));
  assert.equal(
    (await stat(delivery.metadata.prompt_path!)).mode & 0o777,
    0o600,
  );
});
test("CLI version checks execute real Node and reject non-exact version tokens", async (t) => {
  const rt = await runtime(t),
    agent = new CLIAgent({
      name: "node",
      checkCmd: "command -v node",
      versionCmd: "node --version",
      version: process.versions.node,
    });
  await agent.check(rt);
  assert.equal((await agent.inspectRuntime(rt)).version, process.versions.node);
  assert.equal(normalizeVersionOutput("v1.02.0"), "");
  assert.equal(normalizedConfiguredVersion("1.2.03"), "");
  assert.equal(normalizeVersionOutput("Claude 2.1.280 (stable)"), "2.1.280");
  assert.equal(
    checkCommandForOS(" command -v codex >/dev/null 2>&1", "windows"),
    "where codex >nul 2>&1",
  );
});
test("MCP shell reference expansion uses real environment without executing credential text", async (t) => {
  const rt = await runtime(t),
    secret = 'a "quote" $(touch forbidden) `exit 1`';
  const r = await rt.exec(
    "printf %s " + shellExpandedValue("Bearer ${TOKEN}"),
    { env: { TOKEN: secret } },
  );
  assert.equal(r.stdout, "Bearer " + secret);
  await assert.rejects(stat(path.join(rt.workspace(), "forbidden")));
  assert.throws(
    () => shellExpandedValue("$BAD-NAME"),
    /invalid environment variable/,
  );
});
test("installation Go template contract executes real configured shell command", async (t) => {
  const rt = await runtime(t),
    agent = new CLIAgent({
      name: "shell",
      installMCPCmd:
        '{{if eq .Transport "stdio"}}printf "%s\\n" {{range .Args}}{{printf "%q" .}} {{end}}> {{.Workspace}}/installed.txt{{else}}exit 5{{end}}',
    });
  await agent.installMCP(rt, {
    servers: [
      { name: "filesystem", transport: "stdio", args: ["one", "two words"] },
    ],
  });
  assert.equal(
    await readFile(path.join(rt.workspace(), "installed.txt"), "utf8"),
    "one\ntwo words\n",
  );
});
test("Go template literals, trim, variables, range, with, pipelines and definitions", () => {
  assert.equal(
    renderGoTemplate(" A \n{{- .Name -}}\n B ", { Name: "x" }),
    " AxB ",
  );
  assert.equal(
    renderGoTemplate(
      '{{$x := .Name}}{{with .Env}}{{index . "A"}}{{end}}:{{range $i, $v := .Args}}{{$i}}={{$v}};{{else}}empty{{end}}:{{$x | printf "%q"}}',
      { Name: "x", Env: { A: "env" }, Args: ["a", "b"] },
    ),
    'env:0=a;1=b;:"x"',
  );
  assert.equal(
    renderGoTemplate(
      '{{define "item"}}[{{.}}]{{end}}{{template "item" .Name}}',
      { Name: "x" },
    ),
    "[x]",
  );
  assert.equal(
    renderGoTemplate("{{if gt (len .Args) 1}}many{{else}}few{{end}}", {
      Args: ["a", "b"],
    }),
    "many",
  );
  assert.throws(() => renderGoTemplate("{{ .Name", {}), /unclosed/);
  assert.throws(
    () => renderGoTemplate("{{ unknown .Name }}", {}),
    /unsupported/,
  );
});
test("Claude provider diagnosis respects trailing scan windows and resume command", () => {
  assert.ok(providerAuthFailureText('{"api_error_status": 403}'));
  assert.ok(providerRateLimitText("HTTP 429"));
  assert.equal(providerRateLimitText("rate limit" + "x".repeat(2100)), "");
  assert.match(
    buildClaudeResumeCmd("session", "model", "next"),
    /--resume session/,
  );
});
test(
  "real Claude Docker install, static preflight and project MCP registration",
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
    const agent = new ClaudeCodeAgent({ name: "claude-code" }),
      signal = AbortSignal.timeout(480_000);
    await agent.install(rt, signal);
    await agent.check(rt, signal);
    const observed = await agent.inspectRuntime(rt, signal);
    assert.ok(observed.version);
    t.diagnostic("Actual Claude version " + observed.version);
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
    const registered = await rt.exec("claude mcp get files", { signal });
    assert.equal(registered.exitCode, 0, registered.stderr);
    assert.match(registered.stdout, /@modelcontextprotocol\/server-filesystem/);
  },
);
test("installation templates match captured real Go text/template outputs", async () => {
  const vectors = JSON.parse(
    await readFile(
      new URL(
        "../../../tests/agent/claude-template-vectors.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    template: string;
    data: Record<string, unknown>;
    output: string;
    error?: string;
  }[];
  for (const v of vectors) {
    assert.equal(v.error, undefined, v.template);
    assert.equal(renderGoTemplate(v.template, v.data), v.output, v.template);
  }
});
