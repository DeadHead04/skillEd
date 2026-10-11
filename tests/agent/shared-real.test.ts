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
import os from "node:os";
import path from "node:path";
import { NoneRuntime } from "../../src/runtime/none.js";
import {
  listSkillFiles,
  installSkill,
  matchSkillPattern,
} from "../../src/agent/skill.js";
import {
  BaseAgent,
  installedVersionGuard,
  versionedPackage,
  formatAgentModel,
  writeLocalArtifact,
  persistSessionArtifact,
  downloadSessionArtifact,
  buildInstructionFromMessages,
} from "../../src/agent/base.js";
import {
  capabilitiesForEngine,
  resolveAdapterConfig,
} from "../../src/agent/capabilities.js";
import type { ResolvedAgentConfig } from "../../src/credentials/index.js";
async function setup(t: test.TestContext) {
  const dir = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "skilled-shared-test-")),
  );
  t.after(() => rm(dir, { force: true, recursive: true }));
  const rt = new NoneRuntime({ type: "none", workspaceDir: dir });
  await rt.create();
  return { rt, dir };
}
test("real skill selection and installation preserve permissions and exclude recursive targets, git and evals", async (t) => {
  const { dir, rt } = await setup(t);
  for (const d of ["src/scripts", "src/evals", "src/.hidden", "src/.git"])
    await mkdir(path.join(dir, d), { recursive: true });
  for (const [f, text, mode] of [
    ["src/SKILL.md", "skill", 0o600],
    ["src/scripts/run.sh", "#!/bin/sh\nprintf hi", 0o755],
    ["src/evals/test.yaml", "eval", 0o600],
    ["src/.hidden/info", "hidden", 0o600],
    ["src/.git/config", "git", 0o600],
  ] as const)
    await writeFile(path.join(dir, f), text, { mode });
  const src = path.join(dir, "src");
  const files = await listSkillFiles(src);
  assert(files.includes(".hidden/info"));
  assert(!files.includes("evals/test.yaml"));
  await installSkill(rt, src, "src/installed");
  assert.equal(
    await readFile(path.join(src, "installed/SKILL.md"), "utf8"),
    "skill",
  );
  assert.equal(
    (await stat(path.join(src, "installed/scripts/run.sh"))).mode & 0o111,
    0o111,
  );
  await installSkill(rt, src, "src/installed");
  await assert.rejects(stat(path.join(src, "installed/installed")));
  await assert.rejects(stat(path.join(src, "installed/.git")));
  await installSkill(rt, src, "filtered", ["**/*.md"]);
  assert.equal(
    await readFile(path.join(dir, "filtered/SKILL.md"), "utf8"),
    "skill",
  );
  await assert.rejects(stat(path.join(dir, "filtered/scripts/run.sh")));
  await assert.rejects(
    installSkill(rt, src, "empty", ["*.does-not-exist"]),
    /0 files/,
  );
  await assert.rejects(listSkillFiles(src, ["[bad"]), /invalid/);
});
test("real symlink roots and target aliases avoid self-copy recursion", async (t) => {
  const { dir, rt } = await setup(t);
  await mkdir(path.join(dir, "src"));
  await writeFile(path.join(dir, "src/SKILL.md"), "content");
  await symlink(path.join(dir, "src"), path.join(dir, "alias"));
  assert.deepEqual(await listSkillFiles(path.join(dir, "alias")), [
    ".",
    "SKILL.md",
  ]);
  await installSkill(rt, path.join(dir, "alias"), "src");
  await installSkill(rt, path.join(dir, "src"), "alias/target");
  assert.equal(
    await readFile(path.join(dir, "src/target/SKILL.md"), "utf8"),
    "content",
  );
  await installSkill(rt, path.join(dir, "src"), "alias/target");
  await assert.rejects(stat(path.join(dir, "src/target/target")));
});
test("real shared artifact helpers archive bytes with private modes and cleanup temporary download", async (t) => {
  const { dir, rt } = await setup(t);
  const output = await writeLocalArtifact(
    path.join(dir, "archive"),
    "../result.txt",
    "local",
  );
  assert.equal(output, path.join(dir, "archive/result.txt"));
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  await persistSessionArtifact(rt, undefined, "output/session.json", "remote");
  const download = await downloadSessionArtifact(
    rt,
    undefined,
    "output/session.json",
  );
  assert(download.ok);
  assert.equal(download.registeredPath, "output/session.json");
  assert.equal(await readFile(download.artifactPath, "utf8"), "remote");
  await download.cleanup();
  await assert.rejects(stat(download.artifactPath));
});
test("base environment, metadata and real PATH probe preserve precedence", async (t) => {
  const { rt } = await setup(t);
  const base = new BaseAgent({
    name: "custom",
    modelProvider: "provider",
    modelName: "model",
    requestedModelName: "wanted",
    protocol: "custom",
    warnings: ["once"],
  });
  assert.equal(
    base.mergeExecOptionsEnv({ env: { A: "caller" } }, { A: "agent", B: "b" })
      .env?.A,
    "caller",
  );
  await base.probeAndMergePATH(rt, "printf '%s' /bin:/usr/bin");
  assert.equal((await rt.exec('printf %s "$PATH"')).stdout, "/bin:/usr/bin");
  await base.probeAndMergePATH(rt, "exit 2");
  assert.equal((await rt.exec('printf %s "$PATH"')).stdout, "/bin:/usr/bin");
  const result = { exit_code: 0, duration_ms: 0, turns: 0 };
  base.annotateSessionResult(result);
  base.annotateSessionResult(result);
  assert.deepEqual((result as any).warnings, ["once"]);
  assert.equal(
    base.buildAgentObservabilityAttrs()["skilled.model"],
    "provider/model",
  );
  assert.equal(
    buildInstructionFromMessages([
      { role: "user", content: "a" },
      { role: "assistant", content: "ignored" },
      { role: "user", content: "b" },
    ]),
    "a\n\nb",
  );
  assert.equal(versionedPackage("pkg", " v1.2.3 "), "pkg@v1.2.3");
  assert.equal(formatAgentModel("provider", ""), "provider");
  assert.equal(installedVersionGuard("command", "latest"), "");
});
function params(value: Partial<ResolvedAgentConfig>): ResolvedAgentConfig {
  return {
    role: "runner",
    engine: "",
    version: "",
    appliedVersion: "",
    protocol: "",
    provider: "",
    model: "",
    appliedProvider: "",
    appliedModel: "",
    appliedAPIKey: "",
    appliedBaseURL: "",
    apiKey: "",
    baseURL: "",
    kwargs: {},
    warnings: [],
    custom: null,
    providerSource: "",
    modelSource: "",
    apiKeySource: "",
    baseURLSource: "",
    ...value,
  };
}
for (const [engine, protocol, version] of [
  ["claude_code", "anthropic", true],
  ["codex", "openai", true],
  ["opencode", "openai", true],
  ["qoder-cli", "qoder", false],
  ["qwen", "openai", true],
  ["my-agent", "custom", false],
] as const)
  test(`source capability vector ${engine}`, () => {
    const c = capabilitiesForEngine(engine);
    assert.equal(c.protocol, protocol);
    assert.equal(c.supportsVersion, version);
    assert.equal(c.arbitraryKwargs, false);
  });
test("source adapter policy vectors retain requested values and isolate credentials", () => {
  const cases: [Partial<ResolvedAgentConfig>, string, string, string][] = [
    [{ engine: "claude_code", model: " model " }, "anthropic", "model", ""],
    [
      {
        engine: "codex",
        provider: "dashscope",
        model: "qwen",
        baseURL: "https://example.test/v1",
      },
      "openai",
      "qwen",
      "dashscope",
    ],
    [
      {
        engine: "codex",
        provider: "dashscope",
        model: "qwen",
        apiKey: "secret",
      },
      "openai",
      "",
      "",
    ],
    [
      {
        engine: "qodercli",
        model: " auto ",
        apiKey: "secret",
        baseURL: "https://example.test",
      },
      "qoder",
      "auto",
      "",
    ],
    [
      { engine: "opencode", provider: "anthropic", model: "claude" },
      "anthropic",
      "claude",
      "anthropic",
    ],
    [{ engine: "custom", model: "opaque/model" }, "custom", "opaque/model", ""],
  ];
  for (const [input, protocol, model, provider] of cases) {
    const p = params(input),
      r = resolveAdapterConfig(p);
    assert.equal(r.protocol, protocol);
    assert.equal(r.appliedModel, model);
    assert.equal(r.appliedProvider, provider);
    assert.equal(r.model, p.model);
    if (input.apiKey) assert.equal(r.appliedAPIKey, "");
  }
  const original = params({
    engine: "codex",
    version: "latest",
    kwargs: {
      bypass_sandbox: "bad",
      max_jsonl_record_bytes: "1.5",
      unknown: "x",
    },
    warnings: ["original"],
  });
  const result = resolveAdapterConfig(original);
  assert.deepEqual(result.kwargs, {});
  assert.equal(Object.keys(original.kwargs).length, 3);
  assert.equal(result.appliedVersion, "");
  assert(result.warnings.length > 3);
  assert.equal(
    resolveAdapterConfig(
      params({ engine: "qodercli", kwargs: { edition: "unknown" } }),
    ).kwargs.edition,
    "global",
  );
  assert.equal(
    resolveAdapterConfig(
      params({
        engine: "codex",
        version: "1.2.3",
        kwargs: { bypass_sandbox: "True", max_jsonl_record_bytes: "1024" },
      }),
    ).appliedVersion,
    "1.2.3",
  );
});
for (const [pattern, file, expected] of [
  ["**/*.md", "SKILL.md", true],
  ["**/*.md", "nested/file.md", true],
  ["*.md", "nested/file.md", false],
  ["{a,b}.md", "b.md", true],
  ["**", "hidden/.file", true],
  ["a/**", "a/b/c", true],
  ["[!a].txt", "b.txt", true],
] as const)
  test(`source glob ${pattern} / ${file}`, () =>
    assert.equal(matchSkillPattern(pattern, file), expected));
