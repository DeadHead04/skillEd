import assert from "node:assert/strict";
import test from "node:test";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import * as observer from "../../plugins/codex-skilled/scripts/observer.js";
const script = resolve("dist/plugins/codex-skilled/scripts/observer.js");
const temp = () => mkdtempSync(join(tmpdir(), "skilled-codex-test-"));
const fixture = JSON.parse(
  readFileSync("tests/plugins/fixtures/codex-reference.json", "utf8"),
) as { op: string; args: any[]; expected?: unknown; error?: string }[];
for (const [i, row] of fixture.entries())
  test(`Codex pinned Python parity ${i + 1}: ${row.op}`, () => {
    const root = temp();
    try {
      const run = () => {
        if (row.op === "redact") return observer.redact(row.args[0]);
        if (row.op === "appendCaseReference")
          return observer.appendCaseReference(row.args[0], row.args[1]);
        if (row.op === "applyMarker") {
          const d = { redactions: [] };
          observer.applyMarker(d, row.args[0], row.args[1]);
          return d;
        }
        observer.handleHook(
          {
            session_id: "same",
            turn_id: "t1",
            hook_event_name: "UserPromptSubmit",
            prompt: row.args[1],
            model: "model",
          },
          root,
        );
        const o = observer.handleHook(
          {
            session_id: "same",
            turn_id: "t1",
            hook_event_name: row.args[0],
            last_assistant_message: "done",
          },
          root,
        );
        if (o) delete o.timing;
        return o;
      };
      if (row.error) assert.throws(run, { message: row.error });
      else assert.deepEqual(run(), row.expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
function hook(root: string, payload: Record<string, unknown>) {
  const r = spawnSync(process.execPath, [script, "ingest-hook"], {
    input: JSON.stringify({ session_id: "process", turn_id: "1", ...payload }),
    encoding: "utf8",
    env: { ...process.env, SKILLED_OBSERVER_DATA: root },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "{}\n");
}
function child(
  args: string[],
  env: NodeJS.ProcessEnv,
  input?: string,
): Promise<string> {
  return new Promise((done, reject) => {
    const p = spawn(process.execPath, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    p.stdout.on("data", (b) => (out += b));
    p.stderr.on("data", (b) => (err += b));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? done(out) : reject(new Error(err || `exit ${code}`)),
    );
    p.stdin.end(input);
  });
}
test("Codex real hook subprocesses redact, instrument and serialize concurrent evidence", async () => {
  const root = temp();
  try {
    hook(root, {
      hook_event_name: "UserPromptSubmit",
      prompt: "Please help TOKEN=private",
    });
    hook(root, {
      hook_event_name: "PostToolUse",
      tool_name: "mcp__skilled_observer__mark_skill_invocation",
      tool_input: { skill_name: "demo-skill" },
    });
    await Promise.all(
      Array.from({ length: 12 }, () =>
        child(
          [script, "ingest-hook"],
          { ...process.env, SKILLED_OBSERVER_DATA: root },
          JSON.stringify({
            session_id: "process",
            turn_id: "1",
            hook_event_name: "PostToolUse",
            tool_name: "mcp__skilled_observer__attach_skill_evidence",
            tool_input: { kind: "file", reference: "output.txt" },
          }),
        ),
      ),
    );
    hook(root, {
      hook_event_name: "Interrupt",
      last_assistant_message: "done sk-abcdefghijklmnop",
    });
    const [o] = observer.listObservations(root);
    assert.equal(o.evidence.length, 12);
    assert.equal(o.outcome.status, "interrupted");
    assert.equal(o.attribution.method, "instrumented");
    assert.doesNotMatch(JSON.stringify(o), /private|sk-abc/);
    assert.equal(statSync(root).mode & 0o777, 0o700);
    assert.equal(
      statSync(observer.safeObservationPath(root, o.id)).mode & 0o777,
      0o600,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("Codex concurrent duplicate writes persist exactly one record", async () => {
  const root = temp();
  try {
    const o = JSON.parse(
      readFileSync(
        "schemas/skill-observation/v1alpha1/fixtures/codex-observation.json",
        "utf8",
      ),
    );
    const code = `import {saveObservation} from ${JSON.stringify(pathToFileURL(script).href)};console.log(saveObservation(process.argv[1],JSON.parse(process.argv[2])));`;
    const outcomes = await Promise.all(
      Array.from({ length: 12 }, () =>
        child(
          ["--input-type=module", "-e", code, root, JSON.stringify(o)],
          process.env,
        ),
      ),
    );
    assert.equal(outcomes.filter((s) => s === "true\n").length, 1);
    assert.deepEqual(observer.getObservation(root, o.id), o);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("Codex actual stdio MCP server supports initialize, notifications, tools, review and errors", async () => {
  const root = temp();
  try {
    hook(root, {
      hook_event_name: "UserPromptSubmit",
      prompt: "Use $skilled-improve for $demo-skill",
    });
    hook(root, { hook_event_name: "Stop" });
    const [o] = observer.listObservations(root);
    assert.equal(o.skill.name, "demo-skill");
    const requests = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "review_skill_observation",
          arguments: { observation_id: o.id, status: "approved" },
        },
      },
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "preview_observation_case",
          arguments: { observation_id: o.id },
        },
      },
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "get_skill_observation",
          arguments: { observation_id: "../../bad" },
        },
      },
    ];
    const output = await child(
      [script, "mcp"],
      { ...process.env, SKILLED_OBSERVER_DATA: root },
      requests.map((v) => JSON.stringify(v)).join("\n") + "\n{broken\n",
    );
    const messages = output
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    assert.equal(messages.length, 6);
    assert.equal(messages[0].result.serverInfo.name, "codex-skilled");
    assert.equal(messages[1].result.tools.length, 8);
    assert.equal(
      messages[2].result.structuredContent.review.status,
      "approved",
    );
    assert.match(
      messages[3].result.structuredContent.yaml,
      /Use \$skilled-improve/,
    );
    assert.equal(messages[4].result.isError, true);
    assert.equal(messages[5].error.code, -32700);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("Codex bundled plugin launches with only bundled files and Node", () => {
  const root = temp();
  try {
    cpSync("dist/bundled-plugins/codex-skilled", join(root, "plugin"), {
      recursive: true,
    });
    const r = spawnSync(process.execPath, ["scripts/observer.js", "mcp"], {
      cwd: join(root, "plugin"),
      env: {
        PATH: process.env.PATH,
        SKILLED_OBSERVER_DATA: join(root, "data"),
      },
      input: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n',
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).result.tools.length, 8);
    const manifest = JSON.parse(
      readFileSync(join(root, "plugin", ".mcp.json"), "utf8"),
    );
    assert.equal(manifest.mcpServers.skilled_observer.command, "node");
    assert.deepEqual(readdirSync(join(root, "plugin", "skills")), [
      "skilled-improve",
    ]);
    assert.equal(
      existsSync(join(root, "plugin", "scripts", "observer.py")),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("Codex candidate approval and symlink confinement use actual files", () => {
  const root = temp();
  try {
    const skill = join(root, "skill");
    mkdirSync(join(skill, "evals"), { recursive: true });
    mkdirSync(join(root, "outside"));
    writeFileSync(join(skill, "SKILL.md"), "---\nname: demo-skill\n---\n");
    writeFileSync(
      join(skill, "evals", "eval.yaml"),
      "schema_version: v1alpha1\ncases:\n  files: []\n",
    );
    const o = JSON.parse(
      readFileSync(
        "schemas/skill-observation/v1alpha1/fixtures/codex-observation.json",
        "utf8",
      ),
    );
    o.review.status = "candidate";
    assert.throws(
      () => observer.writeCandidateCase(root, o, skill),
      /approved/,
    );
    o.review.status = "approved";
    symlinkSync(join(root, "outside"), join(skill, "evals", "cases"));
    assert.throws(
      () => observer.writeCandidateCase(root, o, skill),
      /cases directory/,
    );
    assert.deepEqual(readdirSync(join(root, "outside")), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test(
  "Codex CLI candidate validation and rollback use the actual migrated executable",
  { skip: process.env.SKILLED_PLUGIN_CLI_INTEGRATION !== "1" },
  async () => {
    const root = temp();
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      const launcher = join(bin, "skilled");
      writeFileSync(
        launcher,
        `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${resolve("dist/src/bootstrap.js").replaceAll("'", "'\\''")}' "$@"\n`,
        { mode: 0o755 },
      );
      const moduleURL = pathToFileURL(script).href;
      for (const valid of [true, false]) {
        const skill = join(root, String(valid));
        mkdirSync(join(skill, "evals"), { recursive: true });
        writeFileSync(
          join(skill, "SKILL.md"),
          "---\nname: demo-skill\ndescription: test\n---\nTest skill\n",
        );
        const original = valid
          ? "schema_version: v1alpha1\nenvironment:\n  type: none\nengine:\n  name: codex\ncases:\n  files: []\n"
          : "schema_version: invalid\ncases:\n  files: []\n";
        writeFileSync(join(skill, "evals", "eval.yaml"), original);
        const o = JSON.parse(
          readFileSync(
            "schemas/skill-observation/v1alpha1/fixtures/codex-observation.json",
            "utf8",
          ),
        );
        o.review.status = "approved";
        const code = `import {writeCandidateCase} from ${JSON.stringify(moduleURL)}; try {console.log(JSON.stringify(writeCandidateCase(process.argv[1],JSON.parse(process.argv[2]),process.argv[3])))} catch(e) {console.log(JSON.stringify({error:e.message}))}`;
        const output = JSON.parse(
          await child(
            ["--input-type=module", "-e", code, root, JSON.stringify(o), skill],
            { ...process.env, PATH: `${bin}:${process.env.PATH}` },
          ),
        );
        if (valid) {
          assert.equal(output.validation, "passed", output.error);
          assert.equal(readdirSync(join(skill, "evals", "cases")).length, 1);
        } else {
          assert.match(output.error, /skilled validate failed/);
          assert.equal(
            readFileSync(join(skill, "evals", "eval.yaml"), "utf8"),
            original,
          );
          assert.deepEqual(readdirSync(join(skill, "evals", "cases")), []);
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("Codex observer executable works through a filesystem symlink", () => {
  const root = temp();
  try {
    const launch = join(root, "observer.mjs");
    symlinkSync(script, launch);
    const result = spawnSync(process.execPath, [launch, "mcp"], {
      input: '{"jsonrpc":"2.0","id":1,"method":"ping"}\n',
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        SKILLED_OBSERVER_DATA: join(root, "data"),
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      jsonrpc: "2.0",
      id: 1,
      result: {},
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex observer imports from a real Node stdin module without executing CLI", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: `import {main} from ${JSON.stringify(pathToFileURL(script).href)}; console.log(typeof main);`,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "function\n");
  assert.equal(result.stderr, "");
});
