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
  test(`actual MCP child releases active work on ${mode}, active=${active}`, { timeout: 45000 }, async t => {
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
    const until = async (check: () => Promise<boolean> | boolean, timeoutMs = 10000) => {
      const deadline = Date.now() + timeoutMs;
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
        constraints: { timeout_seconds: 180 },
        context: { files: { "worker.cjs": `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetTimeout(() => {\n${worker}\n}, 120000);` } } }));
      await writeFile(path.join(dir, "eval.yaml"), JSON.stringify({ schema_version: "v1alpha1", skills: [], environment: { type: "none" },
        engine: { name: "hash", custom: { transport: "local", response_format: "session_result", local: { command: process.execPath, args: ["worker.cjs", "${input_file}"] } } },
        cases: { files: ["case.yaml"] }, judge: { type: "rule_based", success: [{ exit_code: 0 }] }, report: { formats: ["json"] } }));
      send(2, "tools/call", { name: "skilled_run", arguments: { path: "eval.yaml", dryRun: false } });
      await until(async () => { try { workerPid = Number(await readFile(pidFile, "utf8")); return !!workerPid; } catch { return false; } });
    }
    if (mode === "EOF") child.stdin.end(); else child.kill("SIGTERM");
    const [code, signal] = await exit;
    // Windows child.kill terminates the process; it cannot deliver a catchable
    // POSIX SIGTERM. Still require its evaluation descendants to be cleaned up.
    if (process.platform === "win32" && mode === "SIGTERM") {
      assert.equal(code, null, stderr);
      assert.equal(signal, "SIGTERM");
    } else {
      assert.equal(code, 0, stderr);
      assert.equal(signal, null);
    }
    assert.doesNotMatch(stderr, /unsettled top-level await/);
    if (workerPid) await until(() => {
      try { process.kill(workerPid!, 0); return false; }
      catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
    }, 25000);
  });

for (const mode of ["closed-channels", "expired-heartbeat", "missing-first-heartbeat"] as const)
test(`supervised CLI cleans real descendants after ${mode}`, { timeout: 40000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "skilled-supervisor-pipes-"));
  await writeFile(path.join(directory, "SKILL.md"), "---\nname: lifecycle-test\ndescription: Test process cleanup.\n---\n");
  const pidFile = path.join(directory, "engine.pid");
  const worker = await readFile(new URL("../../../tests/integration/phase3/worker.cjs", import.meta.url), "utf8");
  await writeFile(path.join(directory, "case.yaml"), JSON.stringify({
    id: "delayed-hash", input: { prompt: "hash this" }, constraints: { timeout_seconds: 180 },
    context: { files: { "worker.cjs": `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetTimeout(() => {\n${worker}\n}, 120000);` } },
  }));
  await writeFile(path.join(directory, "eval.yaml"), JSON.stringify({
    schema_version: "v1alpha1", skills: [], environment: { type: "none" },
    engine: { name: "hash", custom: { transport: "local", response_format: "session_result", local: { command: process.execPath, args: ["worker.cjs", "${input_file}"] } } },
    cases: { files: ["case.yaml"] }, judge: { type: "rule_based", success: [{ exit_code: 0 }] }, report: { formats: ["json"] },
  }));
  const child = spawn(process.execPath, [bootstrap, "run", "eval.yaml", "--output-dir", "reports"], {
    cwd: directory, env: { ...process.env, OTEL_SDK_DISABLED: "true", SKILLED_CONFIG: "", SKILLED_MCP_SUPERVISED: "1" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const exited = once(child, "exit");
  let diagnostics = "";
  child.stdout!.resume();
  child.stderr!.on("data", data => { diagnostics += String(data); });
  let enginePid: number | undefined;
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (enginePid) { try { process.kill(enginePid, "SIGKILL"); } catch {} }
    await rm(directory, { recursive: true, force: true });
  });
  const deadline = Date.now() + 10000;
  while (!enginePid) {
    try { enginePid = Number(await readFile(pidFile, "utf8")); } catch {}
    if (Date.now() >= deadline || child.exitCode !== null)
      throw new Error(`Actual supervised engine did not start (exit=${child.exitCode}): ${diagnostics}`);
    if (!enginePid) await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (mode !== "missing-first-heartbeat") child.send({ type: "skilled.supervisor-heartbeat" });
  const lastRenewal = performance.now();
  if (mode === "closed-channels") {
    child.stdout!.destroy();
    child.stderr!.destroy();
    child.disconnect();
  }
  // In heartbeat modes this supervisor remains alive, keeps pipes/IPC open,
  // and deliberately never renews the lease. PID checks cannot pass the test.
  const [code, signal] = await exited;
  assert.equal(code, 1, "Lost supervisor must fail the evaluation after cleanup");
  assert.equal(signal, null, "The CLI must finish cleanup rather than be force-killed");
  if (mode === "expired-heartbeat") assert.ok(performance.now() - lastRenewal >= 9000,
    "The real lease should expire, rather than an unrelated early failure");
  const cleanupDeadline = Date.now() + 10000;
  for (;;) {
    try { process.kill(enginePid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") break;
      throw error;
    }
    if (Date.now() >= cleanupDeadline) throw new Error(`Engine ${enginePid} survived closed supervisor channels`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  enginePid = undefined;
});
