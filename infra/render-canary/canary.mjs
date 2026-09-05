import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
const report = { schemaVersion: "skilled-readiness-v1", status: "blocked", checkedAt: new Date().toISOString(), imageRevision: process.env.RENDER_GIT_COMMIT ?? "local-canary", checks: [] };
const add = (name, status, detail) => report.checks.push({ name, status, detail });
const root = await mkdtemp(join(tmpdir(), "skilled-canary-"));
const home = join(root, "home"), workspace = join(root, "workspace"), sibling = join(root, "sibling");
await Promise.all([mkdir(home), mkdir(workspace), mkdir(sibling)]);
await writeFile(join(sibling, "synthetic-marker.txt"), "synthetic-canary-marker");
await writeFile(join(workspace, "input.txt"), "fixture");
await writeFile(join(home, "config.toml"), `default_permissions = "skilled-canary"
[permissions.skilled-canary]
extends = ":workspace"
[permissions.skilled-canary.filesystem]
":root" = "deny"
":minimal" = "read"
":tmpdir" = "deny"
":slash_tmp" = "deny"
"${workspace}" = "write"
[permissions.skilled-canary.network]
enabled = false
`);
const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, TMPDIR: workspace, TZ: "UTC" };
add("non_root", process.getuid?.() > 0 ? "passed" : "failed", `uid=${process.getuid?.()}`);
async function probe(name, code) {
  try {
    const result = await execute("codex", ["sandbox", "linux", "--permissions-profile", "skilled-canary", "python3", "-c", code], { cwd: workspace, env, timeout: 10_000, maxBuffer: 32_000 });
    add(name, "passed", result.stdout.trim() || "probe passed");
  } catch (error) { add(name, "failed", String(error.stderr || error.message).slice(0, 2000)); }
}
await probe("workspace", "from pathlib import Path; assert Path('input.txt').read_text() == 'fixture'; Path('output.txt').write_text('result'); print('permitted fixture read and output write')");
await probe("hidden_reads", `from pathlib import Path\ntry:\n Path(${JSON.stringify(join(sibling, "synthetic-marker.txt"))}).read_text()\nexcept (PermissionError,FileNotFoundError):\n print('synthetic sibling marker denied')\nelse:\n raise RuntimeError('sibling read was allowed')`);
await probe("script_judge", "import json; print(json.dumps({'schemaVersion':'skilled-grading-v1','assertions':[{'id':'exact','passed':True,'evidence':'fixture'}],'error':None}))");
await probe("network_denial", "import socket\ns=socket.socket()\ns.settimeout(2)\ntry:\n s.connect(('1.1.1.1',443))\nexcept PermissionError:\n print('network denied by permission')\nexcept OSError as e:\n if e.errno not in (1,13,101): raise\n print('network unavailable inside sandbox')\nelse:\n raise RuntimeError('outbound connection was allowed')\nfinally:\n s.close()");
// These acceptance checks require dedicated fixtures or an explicitly authorized real session.
for (const name of ["process_isolation", "resource_limits", "codex_initial", "codex_resume", "app_server", "judge_correction", "login_persistence", "conversation_recovery"]) add(name, "pending", "Not certified by this credential-free canary");
await rm(root, { recursive: true, force: true });
console.log(JSON.stringify(report));
createServer((request, response) => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(request.url === "/health" ? { status: "alive", execution: report.status } : report)); }).listen(Number(process.env.PORT ?? 10000), "0.0.0.0");
