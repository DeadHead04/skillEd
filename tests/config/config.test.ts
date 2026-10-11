import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { decode, parseYAML } from "../../src/contracts/decode.js";
import {
  Loader,
  parseEvalConfig,
  parseCaseConfig,
  defaultEvalConfig,
  findSkillDir,
  extractFrontmatter,
  toRuntimeConfig,
} from "../../src/config/loader.js";
import {
  validateAll,
  validateCasesWithEvalDefaults,
  validateGlob,
} from "../../src/config/validator.js";
import { mergeCaseMCP, resolveJudgePlan } from "../../src/config/judge-plan.js";
import {
  resolveCustomEngineConfig,
  resolveEnvRefsStrict,
  resolveEnvRefs,
  isSensitiveEnvName,
} from "../../src/config/customengine.js";
import {
  isExactVersion,
  supportsVersion,
} from "../../src/contracts/agentkind.js";
import {
  parseTemplateToken,
  workspaceRelPathSafe,
} from "../../src/contracts/customengine.js";
import {
  finalAssistantMessage,
  toolCalls,
  messagesForTurn,
  assistantMessagesForTurn,
} from "../../src/contracts/transcript.js";
import type { EvalConfig, MCPConfig } from "../../src/contracts/schema.js";
const evalDoc =
  "schema_version: v1alpha1\nenvironment: {type: none}\nengine: {name: codex}\ncases: {files: [evals/cases/check.yaml]}\n";
test("actual filesystem evaluation loader finds Skill, resolves paths and derives case ID", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skilled-config-"));
  try {
    await mkdir(path.join(dir, "evals", "cases"), { recursive: true });
    await writeFile(
      path.join(dir, "SKILL.md"),
      "---\nname: declared-name\n---\nDescription",
    );
    await writeFile(path.join(dir, "evals", "eval.yaml"), evalDoc);
    await writeFile(
      path.join(dir, "evals", "cases", "check.yaml"),
      "input: {prompt: Check this}\n",
    );
    const loader = await Loader.create(path.join(dir, "evals", "eval.yaml"));
    assert.equal(loader.skillDir, dir);
    assert.equal(await loader.skillName(), "declared-name");
    assert.equal(loader.fixtureDir, path.join(dir, "evals", "fixtures"));
    assert.equal(loader.casesDir, path.join(dir, "evals", "cases"));
    const result = await loader.loadAll();
    assert.equal(result.cases[0].id, "check");
    assert.equal(result.cases[0].sourceFile, "evals/cases/check.yaml");
    assert.doesNotThrow(() => validateAll(result));
    await assert.rejects(
      loader.loadCaseConfig("missing.yaml"),
      /failed to read case file/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("defaults preserve missing required fields, negative timeout and explicit empty arrays", () => {
  const empty = parseEvalConfig("");
  assert.equal(empty.schema_version, "");
  assert.equal(empty.engine.name, "");
  assert.equal(empty.environment.type, "");
  assert.equal(empty.cases.defaults.timeout_seconds, 300);
  assert.equal(empty.cases.parallelism, 1);
  assert.deepEqual(empty.report.formats, ["json"]);
  assert.equal(empty.skills, null);
  const c = parseEvalConfig(
    "cases: {defaults: {timeout_seconds: -1}}\nreport: {formats: []}\nskills: []\n",
  );
  assert.equal(c.cases.defaults.timeout_seconds, -1);
  assert.deepEqual(c.report.formats, []);
  assert.deepEqual(c.skills, []);
  const a = defaultEvalConfig(),
    b = defaultEvalConfig();
  a.environment.env.X = "changed";
  assert.equal(b.environment.env.X, undefined);
  assert.deepEqual(b.skills, []);
  assert.equal(a.environment.workspace_mount, "/workspace");
});
test("YAML field presence, typed scalar behavior and unknown matcher handling", () => {
  for (const raw of ["judge: null", "judge: {}", "judge: {type: script}"])
    assert.equal(parseEvalConfig(raw).judgeSet, true);
  assert.equal(parseEvalConfig("judges: null").judgesSet, true);
  assert.equal(parseEvalConfig("judges: null").judges, null);
  assert.deepEqual(parseEvalConfig("judges: []").judges, []);
  const c = parseEvalConfig("environment: {env: {ENABLED: yes, COUNT: 1}}");
  assert.equal(c.environment.env.ENABLED, "yes");
  assert.equal(c.environment.env.COUNT, "1");
  assert.throws(
    () => parseEvalConfig("schema_version: x\nschema_version: y"),
    /unique|already set/,
  );
  assert.throws(
    () => parseEvalConfig("cases: {parallelism: wrong}"),
    /cannot unmarshal/,
  );
  const r = parseCaseConfig(
    "input: {prompt: Hi}\njudge: {success: [{output_not_contains: bad}]}",
  );
  assert.throws(
    () => validateCasesWithEvalDefaults(parseEvalConfig(evalDoc), [r]),
    /no recognizable matcher/,
  );
});
test("frontmatter does not parse markdown bodies or accept a misplaced fence", () => {
  assert.equal(
    extractFrontmatter("---\r\nname: hello\r\n---\r\nbody"),
    "name: hello\r",
  );
  assert.equal(extractFrontmatter(" ---\nname: nope\n---"), undefined);
  assert.equal(extractFrontmatter("---\nname: missing"), undefined);
});
test("judge plans preserve list replacement, identity, explicit presence and scalar inheritance", () => {
  const e = parseEvalConfig(
    evalDoc +
      "judge: {type: agent_judge, model: provider/model, pass_threshold: 0.9, timeout_seconds: 5, criteria: [ok]}",
  );
  const c = parseCaseConfig(
    "input: {prompt: hi}\njudge: {type: agent_judge, criteria: [local], pass_threshold: 0}",
  );
  const plan = resolveJudgePlan(e, c);
  assert.equal(plan.judges[0].model, "provider/model");
  assert.equal(plan.judges[0].pass_threshold, 0);
  assert.equal(plan.judges[0].timeout_seconds, 5);
  const list = parseEvalConfig(evalDoc + "judges: [{id: a, type: rule_based}]");
  assert.equal(
    resolveJudgePlan(list, parseCaseConfig("input: {prompt: hi}")).multi,
    true,
  );
  assert.throws(
    () => resolveJudgePlan(list, parseCaseConfig("judge: {}")),
    /judge.type is required/,
  );
  assert.throws(
    () => resolveJudgePlan(parseEvalConfig("judge: null\njudges: []"), c),
    /both judge and judges/,
  );
  assert.throws(
    () =>
      resolveJudgePlan(
        parseEvalConfig("judges: [{id: A, type: script}]"),
        parseCaseConfig(""),
      ),
    /safe lowercase/,
  );
});
test("case MCP replaces whole entry without aliasing or changing order", () => {
  const a = decode<MCPConfig>("MCPConfig", {
    servers: [
      { name: "one", mode: "real", command: "server", args: ["x"] },
      { name: "filesystem", mode: "real" },
    ],
  });
  const b = decode<MCPConfig>("MCPConfig", {
    servers: [
      { name: "one", mode: "mocked", config_ref: "fixture.json" },
      { name: "two", mode: "mocked", config_ref: "two.json" },
    ],
  });
  const c = mergeCaseMCP(a, b);
  assert.deepEqual(
    c.servers.map((s) => s.name),
    ["one", "filesystem", "two"],
  );
  assert.equal(c.servers[0].command, "");
  c.servers[0].config_ref = "changed";
  assert.equal(b.servers[0].config_ref, "fixture.json");
  assert.throws(
    () =>
      mergeCaseMCP(
        a,
        decode<MCPConfig>("MCPConfig", {
          servers: [{ name: "one", mode: "real" }],
        }),
      ),
    /must use mode/,
  );
});
test("custom engine environment expansion follows active transport and CLI overrides", () => {
  const c = parseEvalConfig(
    'engine:\n  name: custom\n  model: {provider: "${MISSING}", name: "${MODEL}"}\n  custom:\n    transport: local\n    env: {TOKEN: "${CUSTOM_TOKEN}"}\n    local: {command: "${BIN}", args: ["${input_file}", "${FALLBACK:-ok}"]}\n    http: {url: "${INACTIVE}"}\n',
  );
  resolveCustomEngineConfig(c, {
    skipModelProvider: true,
    env: { BIN: "/opt/agent", MODEL: "actual", CUSTOM_TOKEN: "private" },
  });
  assert.equal(c.engine.model.provider, "${MISSING}");
  assert.equal(c.engine.model.name, "actual");
  assert.equal(c.engine.custom?.local?.command, "/opt/agent");
  assert.equal(c.engine.custom?.env.TOKEN, "private");
  assert.deepEqual(c.engine.custom?.local?.args, ["${input_file}", "ok"]);
  assert.equal(c.engine.custom?.http?.url, "${INACTIVE}");
  c.engine.name = "codex";
  c.engine.model.provider = "openai";
  resolveCustomEngineConfig(c, { env: {} });
});
test("strict template expansion blocks credentials in commands without blocking env transport", () => {
  for (const value of [
    "${API_KEY}",
    "${kwargs.api-key}",
    "${kwargs.apiKey}",
    "${kwargs.bearerToken}",
    "${api_key}",
    "${session_id}",
    "${kwargs}",
    "${session_input}",
    "${WRAPPER}",
  ])
    assert.throws(
      () => resolveEnvRefsStrict(value, { WRAPPER: "${SECRET_TOKEN}" }),
      /secret-like/,
    );
  for (const value of [
    "sk-123456789012345678901234",
    "${BENIGN:-sk-123456789012345678901234}",
    "${BENIGN}",
  ])
    assert.throws(
      () =>
        resolveEnvRefsStrict(value, { BENIGN: "sk-123456789012345678901234" }),
      /credential/,
    );
  assert.equal(resolveEnvRefs("${API_KEY}", { API_KEY: "secret" }), "secret");
  assert.equal(
    resolveEnvRefsStrict("${MONKEY_PATH}", { MONKEY_PATH: "/tmp" }),
    "/tmp",
  );
  assert.equal(resolveEnvRefsStrict("${prompt}", {}), "${prompt}");
  assert.throws(
    () => resolveEnvRefs("${ABSENT?required message}", {}),
    /required message/,
  );
  assert.throws(
    () => resolveEnvRefsStrict("${A}", { A: "${B}", B: "${A}" }),
    /maximum depth/,
  );
  assert.equal(resolveEnvRefs("unfinished ${X", {}), "unfinished ${X");
  assert.equal(isSensitiveEnvName("MONKEY_PATH"), false);
});
test("custom transport contract rejects unsafe files, stateful text and reserved kwargs", () => {
  for (const custom of [
    { transport: "local" },
    { transport: "http", http: { url: "https://example.test", method: "GET" } },
    {
      transport: "local",
      local: { command: "echo" },
      conversation_mode: "stateful",
      response_format: "text",
    },
    { transport: "local", local: { command: "echo" }, kwargs: { prompt: "x" } },
    {
      transport: "http",
      http: { url: "https://example.test", files: [{ path: "../secret" }] },
    },
  ]) {
    const c = decode<EvalConfig>("EvalConfig", {
      engine: { name: "my-engine", custom },
    });
    assert.throws(() => resolveCustomEngineConfig(c));
  }
  assert.doesNotThrow(() =>
    resolveCustomEngineConfig(
      decode<EvalConfig>("EvalConfig", {
        engine: { name: "codex", custom: { transport: "bad" } },
      }),
    ),
  );
});
test("leaf contract helpers preserve version/template/transcript behavior", () => {
  for (const v of ["1.2.3", "v1.2.3", "1.2.3-beta.1+build"])
    assert.equal(isExactVersion(v), true);
  for (const v of ["latest", "01.2.3", "1.2", "1.2.3-01"])
    assert.equal(isExactVersion(v), false);
  assert.equal(supportsVersion("qodercli"), false);
  assert.equal(supportsVersion("qwen-code"), true);
  assert.deepEqual(parseTemplateToken("X:-a?b"), {
    name: "X",
    default: "a?b",
    errMsg: "",
    hasDefault: true,
    hasErrForm: false,
  });
  assert.equal(workspaceRelPathSafe("a/../b"), false);
  assert.equal(workspaceRelPathSafe("**/*.json"), true);
  const transcript = [
    { role: "assistant", content: "old", turn: 1 },
    { role: "tool_call", turn: 1 },
    { role: "assistant", content: "new", turn: 2 },
  ];
  assert.equal(finalAssistantMessage(transcript), "new");
  assert.equal(toolCalls(transcript).length, 1);
  assert.equal(messagesForTurn(transcript, 1).length, 2);
  assert.equal(assistantMessagesForTurn(transcript, 2).length, 1);
  const e = defaultEvalConfig().environment;
  e.ready_timeout_seconds = 3;
  e.sandbox_timeout_seconds = 4;
  assert.equal(toRuntimeConfig(e).readyTimeoutMs, 3000);
  assert.equal(toRuntimeConfig(e).sandboxTimeoutMs, 4000);
  for (const p of ["[", "a{b", "a}", "[]", "a\\"])
    assert.equal(validateGlob(p), false);
  for (const p of ["**/*.md", "{a,b}/[xy]", "a\\*"])
    assert.equal(validateGlob(p), true);
});

test("YAML typed scalar spellings and first document match Go decoding", () => {
  const c = parseEvalConfig(
    "engine: {model: {name: 00123}}\nenvironment: {env: {NUMBER: 1.00}}\ncases: {parallelism: 1.9}\n---\nengine: {name: ignored}",
  );
  assert.equal(c.engine.model.name, "00123");
  assert.equal(c.environment.env.NUMBER, "1.00");
  assert.equal(c.cases.parallelism, 1);
  assert.throws(
    () => parseEvalConfig("benchmark: {enabled: yEs}"),
    /cannot unmarshal/,
  );
  assert.equal(
    parseEvalConfig("benchmark: {enabled: yes}").benchmark.enabled,
    true,
  );
  assert.equal(
    parseEvalConfig("cases: {parallelism: 0777}").cases.parallelism,
    511,
  );
});
