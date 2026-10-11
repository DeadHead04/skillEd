import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  Resolver,
  resolveRunnerConfig,
  resolveJudgeConfig,
  resolveModelRef,
  explicitConnectionValue,
  maskAPIKey,
} from "../../src/credentials/index.js";
import { parseDotenv } from "../../src/credentials/dotenv.js";
import { decode } from "../../src/contracts/decode.js";
import type {
  EngineConfig,
  JudgeConfig,
  UserConfig,
} from "../../src/contracts/schema.js";
import {
  loadEffective,
  loadFile,
  overlay,
  applyEnv,
  mergeKwargs,
  withContext,
  fromContext,
  redactTaggedFields,
} from "../../src/userconfig/index.js";
import { setOutput, setVerbosity } from "../../src/logging/index.js";
const engine = (v: unknown) => decode<EngineConfig>("EngineConfig", v);
const judge = (v: unknown) => decode<JudgeConfig>("JudgeConfig", v);
async function temp(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skilled-credentials-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test("real credentials file protocol endpoints, explicit empties and source priorities", () =>
  temp(async (dir) => {
    const file = path.join(dir, "credentials.yaml");
    await writeFile(
      file,
      `providers:
  gateway:
    api_key: flat-key
    base_url: https://flat.test
    openai: {api_key: openai-key, base_url: https://openai.test}
    anthropic: {api_key: anthropic-key, base_url: https://anthropic.test}
  empty:
    api_key: flat-key
    base_url: https://flat.test
    openai: {api_key: null, base_url: null}
    anthropic: {api_key: "", base_url: ""}
`,
    );
    const env: NodeJS.ProcessEnv = {};
    const r = new Resolver(file, { env });
    await r.load({ dotenvPath: path.join(dir, "missing.env") });
    for (const [protocol, key, url] of [
      ["openai", "openai-key", "https://openai.test"],
      ["anthropic", "anthropic-key", "https://anthropic.test"],
      ["custom", "flat-key", "https://flat.test"],
    ]) {
      const c = r.resolveModelConnection({ provider: "gateway", protocol });
      assert.equal(c.apiKey, key);
      assert.equal(c.baseURL, url);
      assert.equal(c.apiKeySource, "resolver");
      assert.equal(c.authMode, "injected");
      assert.equal(JSON.stringify(c).includes(key), false);
    }
    for (const protocol of ["openai", "anthropic"]) {
      const c = r.resolveModelConnection({ provider: "empty", protocol });
      assert.equal(c.apiKey, "");
      assert.equal(c.apiKeySet, true);
      assert.equal(c.baseURL, "");
      assert.equal(c.baseURLSet, true);
    }
    env.GATEWAY_API_KEY = "env-key";
    env.GATEWAY_BASE_URL = "https://env.test";
    const c = r.resolveModelConnection({
      provider: "gateway",
      protocol: "openai",
    });
    assert.equal(c.apiKey, "env-key");
    assert.equal(c.baseURL, "https://env.test");
    const suppressed = r.resolveModelConnection({
      provider: "gateway",
      protocol: "openai",
      apiKey: explicitConnectionValue("", "cli"),
      baseURL: explicitConnectionValue("", "cli"),
    });
    assert.equal(suppressed.apiKey, "");
    assert.equal(suppressed.authMode, "agent_local");
    assert.equal(suppressed.baseURL, "");
    assert.equal(suppressed.apiKeySource, "cli");
    const copy = r.getProviderConfiguration("gateway")!;
    copy.endpoints.openai.baseURL.value = "changed";
    assert.equal(
      r.getProviderConfiguration("gateway")?.endpoints.openai.baseURL.value,
      "https://openai.test",
    );
    assert.equal(
      JSON.stringify(r.getProviderConfiguration("gateway")).includes(
        "flat-key",
      ),
      false,
    );
    assert.equal(
      JSON.stringify(r.getProviderConfiguration("gateway")).includes(
        "openai-key",
      ),
      false,
    );
  }));
test("legacy credential lookup and missing/corrupt optional files", () =>
  temp(async (dir) => {
    const file = path.join(dir, "credentials.yaml");
    await writeFile(
      file,
      "providers:\n  gateway:\n    openai: {api_key: openai-key, base_url: https://openai.test}\n    anthropic: {api_key: other-key, base_url: https://other.test}\n",
    );
    const r = new Resolver(file, { env: {} });
    await r.load({ dotenvPath: path.join(dir, "missing.env") });
    assert.equal(r.get("gateway")?.apiKey, "openai-key");
    assert.equal(r.get("gateway")?.baseURL, "https://openai.test");
    const warnings: string[] = [];
    await writeFile(file, "bad: [");
    await new Resolver(file, { env: {}, warn: (m) => warnings.push(m) }).load({
      dotenvPath: path.join(dir, "missing.env"),
    });
    assert.equal(warnings.length, 1);
    await new Resolver(path.join(dir, "absent"), {
      env: {},
      warn: () => assert.fail("missing file must be silent"),
    }).load({ dotenvPath: path.join(dir, "missing.env") });
  }));
test("runner and judge retain independent provider namespaces and CLI priority", () =>
  temp(async (dir) => {
    const file = path.join(dir, "credentials.yaml");
    await writeFile(
      file,
      "providers:\n  gateway: {api_key: file-key, base_url: https://file.test}\n  independent: {api_key: judge-key, base_url: https://judge.test}\n",
    );
    const env = {
      GATEWAY_API_KEY: "env-key",
      GATEWAY_MODEL: "env-model",
      GATEWAY_BASE_URL: "https://env.test",
    };
    const r = new Resolver(file, { env });
    await r.load({ dotenvPath: path.join(dir, "missing.env") });
    const e = engine({
      name: "codex",
      version: "1.2.3",
      model: {
        provider: "gateway",
        name: "yaml-model",
        base_url: "https://yaml.test",
      },
      kwargs: { flag: "yes" },
    });
    const initial = resolveRunnerConfig(e, r);
    assert.equal(initial.model, "env-model");
    assert.equal(initial.apiKey, "env-key");
    assert.equal(initial.baseURL, "https://env.test");
    assert.equal(initial.modelSource, "env");
    const cli = resolveRunnerConfig(e, r, {
      provider: "gateway",
      model: "literal/path",
      apiKey: "cli-key",
    });
    assert.equal(cli.model, "literal/path");
    assert.equal(cli.apiKey, "cli-key");
    assert.equal(cli.modelSource, "cli");
    assert.equal(e.model.name, "yaml-model");
    const inherited = resolveJudgeConfig(judge({}), cli, r);
    assert.equal(inherited.version, "1.2.3");
    assert.equal(inherited.provider, "gateway");
    assert.equal(inherited.apiKey, "env-key");
    inherited.kwargs.flag = "changed";
    assert.equal(cli.kwargs.flag, "yes");
    const independent = resolveJudgeConfig(
      judge({ model: "independent/judge-model" }),
      cli,
      r,
    );
    assert.equal(independent.provider, "independent");
    assert.equal(independent.model, "judge-model");
    assert.equal(independent.apiKey, "judge-key");
    assert.equal(independent.baseURL, "https://judge.test");
    const absent = resolveJudgeConfig(
      judge({ model: "unconfigured/model" }),
      cli,
      r,
    );
    assert.equal(absent.apiKey, "");
    assert.equal(absent.baseURL, "");
  }));
test("model ref and auto normalization preserve original engine rules", () => {
  const r = new Resolver("", {
    env: { GATEWAY_API_KEY: "value", QODERCN_PERSONAL_ACCESS_TOKEN: "value" },
  });
  for (const provider of ["openai", "anthropic", "gateway", "qoder"])
    assert.equal(r.hasProvider(provider), true);
  assert.equal(r.hasProvider("unknown"), false);
  assert.equal(r.hasProvider(""), false);
  assert.deepEqual(resolveModelRef("gateway/model/path", r), {
    provider: "gateway",
    name: "model/path",
  });
  assert.deepEqual(resolveModelRef("opaque/model", r), {
    provider: "",
    name: "opaque/model",
  });
  const base = engine({
    name: "codex",
    model: { provider: "openai", name: "yaml" },
  });
  assert.equal(
    resolveRunnerConfig(base, r, { model: "opaque/model", apiKey: "cli" })
      .provider,
    "",
  );
  assert.equal(
    resolveRunnerConfig(base, r, { model: "opaque/model", apiKey: "cli" })
      .apiKey,
    "cli",
  );
  assert.equal(
    resolveRunnerConfig(
      engine({ name: "opencode", model: { provider: "gateway" } }),
      r,
      { model: "openai/model" },
    ).provider,
    "gateway",
  );
  assert.equal(
    resolveRunnerConfig(engine({ name: "codex", model: { name: "auto" } }), r)
      .model,
    "",
  );
  assert.equal(
    resolveRunnerConfig(
      engine({ name: "qodercli", model: { name: "auto" } }),
      r,
    ).model,
    "auto",
  );
  assert.equal(
    resolveRunnerConfig(base, r, { provider: "gateway", model: "auto" }).model,
    "auto",
  );
  const custom = engine({
    name: "custom",
    custom: {
      transport: "http",
      http: { url: "https://example.test", request_body: { a: [1] } },
    },
    model: { name: "auto" },
  });
  const resolved = resolveRunnerConfig(custom, r);
  assert.equal(resolved.model, "auto");
  (resolved.custom!.http!.request_body as { a: number[] }).a.push(2);
  assert.deepEqual(custom.custom!.http!.request_body, { a: [1] });
  base.custom = custom.custom;
  assert.equal(resolveRunnerConfig(base, r).custom, null);
});
test("credential diagnostics never write selected keys", () => {
  let output = "";
  const restore = setOutput({
    write: (s) => {
      output += s;
      return true;
    },
  });
  setVerbosity(1);
  try {
    resolveRunnerConfig(
      engine({ name: "codex", model: { provider: "openai", name: "example" } }),
      new Resolver("", { env: {} }),
      { apiKey: "test-private-credential" },
    );
    assert.equal(output.includes("test-private-credential"), false);
    assert.match(output, /auth_configured=true/);
  } finally {
    restore();
    setVerbosity(0);
  }
  assert.equal(maskAPIKey("1234"), "****");
  assert.equal(maskAPIKey("123456"), "12****56");
});
test("dotenv files load without overwriting present empty env and preserve quote expansion", () =>
  temp(async (dir) => {
    assert.deepEqual(
      parseDotenv(
        "A=first\nB=${A}\nC='${A}'\nD=\"line\\n${B}\"\nexport E: yes # comment\n",
      ),
      { A: "first", B: "first", C: "${A}", D: "line\nfirst", E: "yes" },
    );
    assert.deepEqual(parseDotenv("FORWARD=${LATER}\nLATER=beta"), {
      FORWARD: "",
      LATER: "beta",
    });
    const file = path.join(dir, ".env");
    await writeFile(file, "ALPHA=from-file\nBETA=from-file\n");
    const env = { ALPHA: "" } as NodeJS.ProcessEnv;
    await new Resolver("", { env }).load({ dotenvPath: file });
    assert.equal(env.ALPHA, "");
    assert.equal(env.BETA, "from-file");
  }));
test("real user/project/explicit file discovery and field-specific overlay", () =>
  temp(async (dir) => {
    const user = path.join(dir, ".config", "skilled");
    await mkdir(user, { recursive: true });
    await writeFile(
      path.join(user, "config.yaml"),
      "telemetry: {service_name: user, verbose: true}\nenv: {A: user, B: user}\nruntime_kwargs: {docker: {a: user}}\n",
    );
    await writeFile(
      path.join(dir, ".skilled.yaml"),
      "telemetry: {service_name: project, verbose: false}\nenv: {B: project}\nruntime_kwargs: {docker: {b: project}}\n",
    );
    const explicit = path.join(dir, "explicit.yaml");
    await writeFile(explicit, "env: {C: explicit}\n");
    const result = await loadEffective({
      homeDir: dir,
      workingDir: dir,
      explicitPath: explicit,
      env: () => "",
    });
    assert.deepEqual(
      result.sources.map((s) => s.kind),
      ["embed", "user", "project", "explicit"],
    );
    assert.equal(result.config.telemetry.service_name, "project");
    assert.equal(result.config.telemetry.verbose, false);
    assert.deepEqual(result.config.env, {
      A: "user",
      B: "project",
      C: "explicit",
    });
    assert.deepEqual(mergeKwargs(result.config, "docker", { a: "eval" }), {
      a: "eval",
      b: "project",
    });
    await assert.rejects(
      loadEffective({
        homeDir: dir,
        workingDir: dir,
        explicitPath: path.join(dir, "missing"),
        env: () => "",
      }),
      /config file not found/,
    );
    const selected = await loadEffective({
      homeDir: dir,
      workingDir: dir,
      env: (k) => (k === "SKILLED_CONFIG" ? explicit : ""),
    });
    assert.equal(selected.sources[1].path, explicit);
  }));
test("corrupt optional configs warn while explicit or invalid final configs fail", () =>
  temp(async (dir) => {
    const bad = path.join(dir, "bad.yaml");
    await writeFile(bad, "env: [broken");
    let warnings = "";
    const result = await loadEffective({
      workingDir: dir,
      homeDir: dir,
      env: (k) => (k === "SKILLED_CONFIG" ? bad : ""),
      warnings: {
        write: (m) => {
          warnings += m;
        },
      },
    });
    assert.deepEqual(result.sources, [{ kind: "embed" }]);
    assert.match(warnings, /ignoring user config/);
    await assert.rejects(loadFile(bad), /parse config/);
    const invalid = path.join(dir, "invalid.yaml");
    await writeFile(invalid, "telemetry: {traces: {protocol: unsupported}}");
    await assert.rejects(
      loadEffective({
        workingDir: dir,
        homeDir: dir,
        explicitPath: invalid,
        env: () => "",
      }),
      /loaded from.*invalid.yaml/,
    );
  }));
test("environment defaults respect existing empty values and telemetry precedence", () => {
  const cfg = decode<UserConfig>("UserConfig", {
    telemetry: {
      service_name: "service",
      verbose: true,
      resource_attributes: { z: "last", a: "first", empty: " " },
    },
    env: { OTEL_SERVICE_NAME: "ignored", OTHER: "default", EMPTY: "" },
  });
  const env: NodeJS.ProcessEnv = { OTEL_SERVICE_NAME: "" };
  assert.deepEqual(applyEnv(cfg, env), [
    "OTEL_LOG_TOOL_CONTENT",
    "OTEL_LOG_TOOL_DETAILS",
    "OTEL_LOG_USER_PROMPTS",
    "OTEL_RESOURCE_ATTRIBUTES",
    "OTHER",
  ]);
  assert.equal(env.OTEL_SERVICE_NAME, "");
  assert.equal(env.OTEL_RESOURCE_ATTRIBUTES, "a=first,z=last");
  assert.equal(env.OTHER, "default");
  assert.equal(env.EMPTY, undefined);
  const overridden = decode<UserConfig>("UserConfig", {
    telemetry: { verbose: false },
  });
  overlay(cfg, overridden);
  const clean: NodeJS.ProcessEnv = {};
  applyEnv(cfg, clean);
  assert.equal(clean.OTEL_LOG_USER_PROMPTS, undefined);
  const sources = [{ kind: "embed" }];
  const context = withContext({ other: 1 }, cfg, sources);
  assert.equal(fromContext(context)?.config, cfg);
  assert.equal(fromContext(undefined), undefined);
  assert.deepEqual(
    redactTaggedFields({ key: "secret", ref: "${API_KEY}" }, ["key", "ref"]),
    { key: "***", ref: "${API_KEY}" },
  );
});

test("credentials typed mappings reject scalar and sequence provider endpoints", () =>
  temp(async (dir) => {
    const file = path.join(dir, "invalid.yaml");
    for (const content of [
      "wrong",
      "[]",
      "providers: []",
      "providers: {vendor: wrong}",
      "providers: {vendor: []}",
      "providers: {vendor: {openai: wrong}}",
      "providers: {vendor: {anthropic: []}}",
      "schema_version: [x]",
    ]) {
      await writeFile(file, content);
      await assert.rejects(
        new Resolver().loadFromFile(file),
        /mapping|unmarshal/,
      );
    }
  }));

test("credential strings preserve numeric scalar lexemes", () =>
  temp(async (dir) => {
    const file = path.join(dir, "credentials.yaml");
    await writeFile(
      file,
      "providers: {vendor: {api_key: 00123, base_url: 1.00}}",
    );
    const r = new Resolver();
    await r.loadFromFile(file);
    assert.equal(r.get("vendor")?.apiKey, "00123");
    assert.equal(r.get("vendor")?.baseURL, "1.00");
  }));
