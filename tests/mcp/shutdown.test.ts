import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bootstrap = fileURLToPath(new URL("../../src/bootstrap.js", import.meta.url));
for (const active of [false, true]) for (const mode of ["EOF", "SIGTERM"] as const)
  test(`actual MCP child exits cleanly on ${mode}, active=${active}`, { timeout: 20000 }, async t => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "skilled-mcp-shutdown-"));
    await writeFile(path.join(dir, "SKILL.md"), "---\nname: lifecycle-test\ndescription: Test process cleanup.\n---\n");
    const child = spawn(process.execPath, [bootstrap, "mcp", "--workspace", dir, "--allow-execution"], {
      cwd: dir, env: { ...process.env, OTEL_SDK_DISABLED: "true", SKILLED_CONFIG: "" }, stdio: ["pipe", "pipe", "pipe"],
    });
    const exit = once(child, "exit");
    let stderr = "", buffer = "";
    const responses = new Map<number, unknown>();
    child.stderr.on("data", data => { stderr += String(data); });
    child.stdout.on("data", data => {
      buffer += String(data);
      let at: number;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const message = JSON.parse(buffer.slice(0, at)) as { id?: number };
        buffer = buffer.slice(at + 1);
        if (message.id !== undefined) responses.set(message.id, message);
      }
    });
    t.after(async () => { if (child.exitCode === null) child.kill("SIGKILL"); await rm(dir, { recursive: true, force: true }); });
    const send = (id: number, method: string, params: object) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    const until = async (check: () => Promise<boolean> | boolean) => {
      const deadline = Date.now() + 10000;
      while (!await check()) {
        if (Date.now() > deadline) throw new Error(`MCP timeout: ${stderr}`);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    };
    send(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "shutdown-check", version: "1" } });
    await until(() => responses.has(1));
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    let workerPid: number | undefined;
    if (active) {
      const pidFile = path.join(dir, "worker.pid");
      const worker = await readFile(new URL("../../../tests/integration/phase3/worker.cjs", import.meta.url), "utf8");
      await writeFile(path.join(dir, "case.yaml"), JSON.stringify({ id: "delay", input: { prompt: "hash this" },
        context: { files: { "worker.cjs": `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetTimeout(() => {\n${worker}\n}, 30000);` } } }));
      await writeFile(path.join(dir, "eval.yaml"), JSON.stringify({ schema_version: "v1alpha1", skills: [], environment: { type: "none" },
        engine: { name: "hash", custom: { transport: "local", response_format: "session_result", local: { command: process.execPath, args: ["worker.cjs", "${input_file}"] } } },
        cases: { files: ["case.yaml"] }, judge: { type: "rule_based", success: [{ exit_code: 0 }] }, report: { formats: ["json"] } }));
      send(2, "tools/call", { name: "skilled_run", arguments: { path: "eval.yaml", dryRun: false } });
      await until(async () => { try { workerPid = Number(await readFile(pidFile, "utf8")); return !!workerPid; } catch { return false; } });
    }
    if (mode === "EOF") child.stdin.end(); else child.kill("SIGTERM");
    const [code, signal] = await exit;
    assert.equal(code, 0, stderr);
    assert.equal(signal, null);
    assert.doesNotMatch(stderr, /unsettled top-level await/);
    if (workerPid) await until(() => {
      try { process.kill(workerPid!, 0); return false; }
      catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
    });
  });
