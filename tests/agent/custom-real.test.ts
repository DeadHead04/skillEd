import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  stat,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  CustomAgent,
  StatefulCustomAgent,
  decodeSessionResult,
  renderTemplate,
  workspacePath,
  validateArtifactFiles,
  deriveTurns,
} from "../../src/agent/custom.js";
import { renderBodyValue } from "../../src/agent/custom-http.js";
import { AgentExecutionError } from "../../src/agent/errors.js";
import { NoneRuntime } from "../../src/runtime/none.js";
import { decode } from "../../src/contracts/decode.js";
import type { CustomEngineConfig } from "../../src/contracts/schema.js";
const execute = promisify(execFile);
async function setup(t: test.TestContext) {
  const dir = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "skilled-custom-test-")),
  );
  t.after(() => rm(dir, { recursive: true, force: true }));
  const rt = new NoneRuntime({ type: "none", workspaceDir: dir });
  await rt.create();
  return { dir, rt };
}
function custom(value: unknown): CustomEngineConfig {
  return decode("CustomEngineConfig", value);
}
const worker = String.raw`const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const prompt=input.messages.map(m=>m.content).join('\n');const digest=crypto.createHash('sha256').update(prompt).digest('hex');const count=input.session_id?Number(input.session_id)+1:1;fs.mkdirSync('results',{recursive:true});fs.writeFileSync('results/digest.txt',digest);const output={exit_code:0,model:'observed-model',session_id:String(count),final_message:digest,transcript:[{role:'assistant',content:digest}],artifacts:{files:[{name:'digest-copy.txt',path:'results/digest.txt'},{name:'inline.txt',content:prompt}]}};if(process.env.MODE==='text'){console.log(digest)}else if(process.env.MODE==='garbage'){console.log('not-json')}else if(process.env.MODE!=='sleep'){const data=JSON.stringify(output);if(process.env.MODE==='file'){fs.mkdirSync(path.dirname(process.argv[3]),{recursive:true});fs.writeFileSync(process.argv[3],data)}else console.log(data)}if(process.env.MODE==='sleep'||process.env.MODE==='partial-sleep'){setTimeout(()=>{},10000)}else if(process.env.MODE==='exit')process.exit(9);`;
async function local(
  t: test.TestContext,
  mode = "stdout",
  extra: Record<string, unknown> = {},
) {
  const { dir, rt } = await setup(t);
  await writeFile(path.join(dir, "engine.cjs"), worker);
  const config = custom({
    transport: "local",
    response_format: "session_result",
    env: { MODE: mode },
    local: {
      command: process.execPath,
      args: ["engine.cjs", "${input_file}", "${output_file}"],
    },
    ...extra,
  });
  return {
    dir,
    rt,
    agent: new CustomAgent({ name: "work-engine", custom: config }),
    config,
  };
}
for (const mode of ["stdout", "file"])
  test(`real local ${mode} engine performs dynamic hashing, artifact copying and state continuation`, async (t) => {
    const { dir, rt, config } = await local(
      t,
      mode,
      mode === "file"
        ? {
            local: {
              command: process.execPath,
              args: ["engine.cjs", "${input_file}", "${output_file}"],
              output_file: "outputs/result.json",
            },
          }
        : {},
    );
    const agent = new StatefulCustomAgent({
      name: "work-engine",
      custom: config,
    });
    const artifactDir = path.join(dir, "archive");
    const prompt = "dynamic " + Math.random();
    const result = await agent.run(rt, { artifactDir }, [
      { role: "user", content: prompt },
    ]);
    assert.equal(
      result.final_message,
      createHash("sha256").update(prompt).digest("hex"),
    );
    assert.equal(result.model, "observed-model");
    assert.equal(result.turns, 1);
    assert.equal(
      await readFile(path.join(artifactDir, "digest-copy.txt"), "utf8"),
      result.final_message,
    );
    assert.equal(
      await readFile(path.join(artifactDir, "inline.txt"), "utf8"),
      prompt,
    );
    assert(!JSON.stringify(result).includes("generated_file_sources"));
    assert(
      result.artifacts?.generated_file_sources?.some((f) =>
        f.endsWith("messages.json"),
      ),
    );
    const next = await agent.runTurn(
      rt,
      { artifactDir },
      { role: "user", content: "next" },
      result.session_id!,
    );
    assert.equal(next.session_id, "2");
    const input = JSON.parse(
      await readFile(path.join(dir, "inputs/messages.json"), "utf8"),
    );
    assert.equal(input.session_id, "1");
    assert(!Object.hasOwn(input, "kwargs"));
  });
test("real local text uses stdout and clears stale configured result", async (t) => {
  const { dir, rt, agent } = await local(t, "text", {
    response_format: "text",
    local: {
      command: process.execPath,
      args: ["engine.cjs", "${input_file}"],
      output_file: "old.json",
    },
  });
  await writeFile(path.join(dir, "old.json"), "stale");
  const result = await agent.run(rt, {}, [{ role: "user", content: "fresh" }]);
  assert.equal(
    result.final_message,
    createHash("sha256").update("fresh").digest("hex"),
  );
  assert.equal(result.turns, 0);
  await assert.rejects(stat(path.join(dir, "old.json")));
  assert(
    result.artifacts?.generated_file_sources?.includes(
      path.join(dir, "old.json"),
    ),
  );
});
test("real nonzero process preserves produced session and exact process exit", async (t) => {
  const { rt, agent } = await local(t, "exit");
  await assert.rejects(
    agent.run(rt, {}, [{ role: "user", content: "exit-work" }]),
    (e: unknown) => {
      assert(e instanceof AgentExecutionError);
      assert.equal(e.result.exit_code, 9);
      assert.equal(
        e.result.final_message,
        createHash("sha256").update("exit-work").digest("hex"),
      );
      return true;
    },
  );
});
for (const mode of ["sleep", "partial-sleep"])
  test(`real timeout ${mode} retains or synthesizes partial work`, async (t) => {
    const { dir, rt, agent } = await local(t, mode, {
      local: {
        command: process.execPath,
        args: ["engine.cjs", "${input_file}"],
        output_file: "outputs/result.json",
      },
    });
    const started = Date.now();
    await assert.rejects(
      agent.run(
        rt,
        { timeoutMs: 150, artifactDir: path.join(dir, "archive") },
        [{ role: "user", content: "timeout" }],
      ),
      (e: unknown) => {
        assert(e instanceof AgentExecutionError);
        if (mode === "sleep") assert.equal(e.result.exit_code, 124);
        else
          assert.equal(
            e.result.final_message,
            createHash("sha256").update("timeout").digest("hex"),
          );
        return true;
      },
    );
    assert(Date.now() - started < 4000);
    if (mode === "sleep") {
      const payload = JSON.parse(
        await readFile(path.join(dir, "archive/session-result.json"), "utf8"),
      );
      assert.equal(payload.exit_code, 124);
    }
    await assert.rejects(stat(path.join(dir, "outputs/result.json")));
  });
test("actual workspace rejects traversal/symlinks and secret command exposure", async (t) => {
  const { dir, rt } = await setup(t);
  await symlink(os.tmpdir(), path.join(dir, "outside"));
  await assert.rejects(workspacePath(rt, "outside/private.txt"), /escapes/);
  await assert.rejects(workspacePath(rt, "../escape"), /escapes/);
  assert.equal(
    await workspacePath(rt, "future/leaf"),
    path.join(dir, "future/leaf"),
  );
  for (const field of ["command", "args"]) {
    const c = custom({
      transport: "local",
      local: {
        command: field === "command" ? "${api_key}" : process.execPath,
        args: field === "args" ? ["${api_key}"] : [],
      },
    });
    await assert.rejects(
      new CustomAgent({
        name: "secret",
        apiKey: "private-secret",
        custom: c,
      }).run(rt, {}, []),
      /API key/,
    );
  }
});
test("real HTTP subprocess work, structured body, headers, multipart, downloaded artifacts and rotating sessions", async (t) => {
  const { dir, rt } = await setup(t);
  await mkdir(path.join(dir, "docs"));
  await writeFile(
    path.join(dir, "docs/source.txt"),
    "actual uploaded " + Math.random(),
  );
  const script = path.join(dir, "transform.cjs");
  await writeFile(
    script,
    "process.stdout.write(require('node:crypto').createHash('sha256').update(process.argv[2]).digest('hex'))",
  );
  const seen: {
    headers: Record<string, string | string[] | undefined>;
    input: any;
    files: Map<string, string>;
  }[] = [];
  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET") {
        res.end(await readFile(path.join(dir, "server-artifact.txt")));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c);
      const request = new Request("http://localhost/", {
        method: "POST",
        headers: req.headers as Record<string, string>,
        body: Buffer.concat(chunks),
      });
      let input: any;
      const files = new Map<string, string>();
      if (req.headers["content-type"]?.startsWith("multipart/")) {
        const form = await request.formData();
        input = JSON.parse(String(form.get("payload")));
        for (const file of form.getAll("files"))
          if (typeof file !== "string") files.set(file.name, await file.text());
      } else input = await request.json();
      seen.push({ headers: req.headers, input, files });
      const session = input.session ?? input;
      const prompt = session.messages.map((m: any) => m.content).join("\n");
      const { stdout } = await execute(process.execPath, [script, prompt]);
      await writeFile(path.join(dir, "server-artifact.txt"), stdout);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          exit_code: 0,
          session_id: String(Number(session.session_id || 0) + 1),
          final_message: stdout,
          artifacts: {
            files: [
              {
                name: "remote.txt",
                url: `http://127.0.0.1:${(server.address() as any).port}/artifact`,
              },
            ],
          },
        }),
      );
    } catch (e) {
      res.statusCode = 500;
      res.end(String(e));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  const port = (server.address() as any).port;
  const c = custom({
    transport: "http",
    kwargs: { task: "hash" },
    http: {
      url: `http://127.0.0.1:${port}/run`,
      headers: { Authorization: "Bearer ${api_key}" },
      request_body: { session: "${session_input}", kwargs: "${kwargs}" },
      files: [{ path: "docs/*.txt" }],
    },
  });
  const agent = new StatefulCustomAgent({
    name: "http-worker",
    apiKey: "transport-secret",
    custom: c,
  });
  const result = await agent.run(
    rt,
    { artifactDir: path.join(dir, "archive") },
    [{ role: "user", content: "real http " + Math.random() }],
  );
  assert.equal(
    await readFile(path.join(dir, "archive/remote.txt"), "utf8"),
    result.final_message,
  );
  assert.equal(seen[0].headers.authorization, "Bearer transport-secret");
  assert.equal(
    seen[0].files.get("docs/source.txt"),
    await readFile(path.join(dir, "docs/source.txt"), "utf8"),
  );
  assert.deepEqual(seen[0].input.kwargs, { task: "hash" });
  assert(!Object.hasOwn(seen[0].input.session, "kwargs"));
  const next = await agent.runTurn(
    rt,
    {},
    { role: "user", content: "second" },
    result.session_id!,
  );
  assert.equal(next.session_id, "2");
  assert.equal(seen[1].input.session.session_id, "1");
});
test("direct source-derived template, parser and artifact validation vectors", () => {
  assert.equal(renderTemplate("${kwargs.none}", {}), "");
  assert.equal(renderTemplate("${model:-fallback}", { model: "" }), "fallback");
  assert.equal(renderTemplate("${model}", { model: "" }), "");
  assert.throws(
    () => renderTemplate("${model:?required}", { model: "" }),
    /required/,
  );
  assert.throws(() => renderTemplate("${unresolved}", {}), /unresolved/);
  assert.deepEqual(
    renderBodyValue(
      {
        session: "${session_input}",
        messages: "${messages}",
        kwargs: "${kwargs}",
        text: "prefix ${model}",
      },
      { session_input: '{"a":1}', messages: "[]", kwargs: "{}", model: "m" },
    ),
    { session: { a: 1 }, messages: [], kwargs: {}, text: "prefix m" },
  );
  assert.equal(deriveTurns([{ role: "assistant" }, { role: "assistant" }]), 2);
  assert.equal(deriveTurns([{ role: "assistant", turn: 5 }]), 5);
  for (const raw of [
    "[]",
    '{"exit_code":"0"}',
    '{"turns":1.5}',
    '{"transcript":{}}',
    '{"artifacts":{"files":[{"content":4}]}}',
  ])
    assert.throws(() => decodeSessionResult(raw));
  assert.equal(
    decodeSessionResult('{"exit_code":0,"unknown":true}').exit_code,
    0,
  );
  for (const files of [
    [{ name: "", content: "a" }],
    [{ name: "a", content: "a", path: "x" }],
    [{ name: "a" }],
  ])
    assert.throws(() => validateArtifactFiles(files));
  validateArtifactFiles([{ name: "a", content: "small" }]);
});

test("HTTP real protocol errors, timeout, missing uploads and URL artifact refusal", async (t) => {
  const { dir, rt } = await setup(t);
  let requested = 0;
  const server = createServer(async (req, res) => {
    requested++;
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c);
    if (req.url === "/wait") {
      setTimeout(() => res.end("late"), 100);
      return;
    }
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/work" });
      res.end();
      return;
    }
    const data = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    const input = data.messages?.map((m: any) => m.content).join("\n") ?? "";
    const output = createHash("sha256").update(input).digest("hex");
    await writeFile(path.join(dir, "http-work.txt"), output);
    if (req.url === "/text") {
      res.end(output);
      return;
    }
    res.statusCode = 503;
    res.end(JSON.stringify({ exit_code: 0, final_message: output }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const agent = (url: string, extra: Record<string, unknown> = {}) =>
    new CustomAgent({
      name: "http",
      apiKey: "url-secret",
      custom: custom({ transport: "http", http: { url }, ...extra }),
    });
  await assert.rejects(
    agent(base + "/work").run(rt, {}, [
      { role: "user", content: "status work" },
    ]),
    (e: unknown) => {
      assert(e instanceof AgentExecutionError);
      assert.equal(e.result.exit_code, 503);
      assert.equal(
        e.result.final_message,
        createHash("sha256").update("status work").digest("hex"),
      );
      return true;
    },
  );
  const text = await agent(base + "/text", { response_format: "text" }).run(
    rt,
    {},
    [{ role: "user", content: "text work" }],
  );
  assert.equal(
    text.final_message,
    createHash("sha256").update("text work").digest("hex"),
  );
  await assert.rejects(
    agent(base + "/wait").run(rt, { timeoutMs: 20 }, []),
    /http request failed/,
  );
  await assert.rejects(agent(base + "/url-secret").run(rt, {}, []), /API key/);
  await assert.rejects(
    agent(base, { http: { url: base, method: "GET" } }).run(rt, {}, []),
    /POST/,
  );
  await assert.rejects(
    agent(base, { http: { url: base, files: [{ path: "absent.txt" }] } }).run(
      rt,
      {},
      [],
    ),
    /matched no files/,
  );
  const before = requested;
  const a = agent(base);
  const opts = { artifactDir: path.join(dir, "archive") };
  assert.equal(
    await a.downloadURLArtifact(opts, {
      name: "refused",
      url: "file:///tmp/x",
    }),
    "",
  );
  assert.equal(
    await a.downloadURLArtifact(opts, {
      name: "refused",
      url: base + "/url-secret",
    }),
    "",
  );
  assert.equal(requested, before);
  assert.equal(
    await a.downloadURLArtifact(opts, {
      name: "redirect",
      url: base + "/redirect",
    }),
    "",
  );
  assert.equal(requested, before + 1);
});
test("custom direct parser preserves observed metadata and masks all source-defined returned text fields", async (t) => {
  const { dir, rt } = await setup(t);
  const agent = new CustomAgent({
    name: "safe",
    apiKey: "key",
    custom: custom({
      transport: "local",
      env: { TOKEN: "environment-secret", FLAG: "short" },
    }),
  });
  const result = await agent.parseSessionResult(
    rt,
    {},
    JSON.stringify({
      engine: "key-engine",
      model: "key-model",
      exit_code: 0,
      stderr: "key environment-secret short",
      transcript: [{ role: "assistant", content: "environment-secret key" }],
    }),
    12,
    [],
  );
  assert.equal(result.engine, "***REDACTED***-engine");
  assert.equal(result.model, "***REDACTED***-model");
  assert.equal(result.final_message, "***REDACTED*** ***REDACTED***");
  assert.equal(result.stderr, "***REDACTED*** ***REDACTED*** short");
  assert.equal(result.duration_ms, 12);
  assert.equal(result.turns, 1);
  for (const raw of [
    "",
    "{}",
    '{"exit_code":null}',
    '{"exit_code":"0"}',
    '{"exit_code":0,"artifacts":{"files":[{"name":"x"}]}}',
  ])
    await assert.rejects(agent.parseSessionResult(rt, {}, raw, 1, []));
  const artifacts = {
    generated_files: ["../outside", path.join(dir, "safe")],
    files: [
      { name: "outside", path: "../outside" },
      { name: "safe", path: "safe" },
    ],
  };
  await agent.collectArtifacts(rt, {}, artifacts);
  assert.deepEqual(artifacts.generated_files, [
    path.join(dir, "safe"),
    path.join(dir, "safe"),
  ]);
});
