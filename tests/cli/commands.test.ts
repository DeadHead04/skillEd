import test from "node:test";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  stat,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { parse } from "yaml";
import {
  extractConfigFlag,
  isInitInvocation,
  parseLongFlag,
} from "../../src/cli/root.js";
import {
  convertEvalToCase,
  parseAnthropicEvals,
  generateEvalConfig,
  computeOutputRelPrefix,
} from "../../src/cli/import.js";
import { initTemplateContent } from "../../src/cli/init.js";
import { formatCaseTable } from "../../src/cli/listcases.js";
import { parseReportInput } from "../../src/cli/report.js";
import { decode, type CaseConfig } from "../../src/config/index.js";
const driver = fileURLToPath(new URL("./driver.js", import.meta.url));
async function temp(t: {
  after: (f: () => Promise<void>) => void;
}): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "skilled-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function run(cwd: string, args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [driver, ...args], {
        cwd,
        env: {
          PATH: process.env.PATH,
          HOME: cwd,
          XDG_CONFIG_HOME: path.join(cwd, "xdg"),
          OTEL_TRACES_EXPORTER: "none",
          OTEL_METRICS_EXPORTER: "none",
        },
      });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    },
  );
}
for (const [args, want] of [
  [[], false],
  [["init"], true],
  [["--config", "/tmp/c.yaml", "init"], true],
  [["--config=/tmp/c.yaml", "init"], true],
  [["--config", "x", "--", "init"], false],
  [["run", "x"], false],
  [["--help"], false],
  [["--quiet", "init"], true],
  [["-X", "init"], true],
] as [string[], boolean][])
  test(`init prescan ${JSON.stringify(args)}`, () =>
    assert.equal(isInitInvocation(args), want));
for (const [args, want] of [
  [["run", "x"], ""],
  [["--config", "/a", "run"], "/a"],
  [["--config=/a", "run"], "/a"],
  [["--config=", "run"], ""],
  [["run", "--config"], ""],
  [["--", "--config", "/a"], ""],
  [["--config", "/first", "--config", "/second"], "/first"],
] as [string[], string][])
  test(`config prescan ${JSON.stringify(args)}`, () =>
    assert.equal(extractConfigFlag(args), want));
test("long flag scanner preserves embedded equals", () => {
  assert.deepEqual(parseLongFlag("--config=x=y"), {
    name: "config",
    hasValue: true,
    consumed: 1,
  });
  assert.deepEqual(parseLongFlag("--"), {
    name: "",
    hasValue: false,
    consumed: 0,
  });
});
test("root version, help, debug help and rejected flags run as processes", async (t) => {
  const dir = await temp(t);
  const version = await run(dir, ["--version"]);
  assert.equal(
    (await run(dir, ["-v"])).stdout,
    "skilled version phase4-test\n",
  );
  assert.equal(version.code, 0, version.stderr);
  assert.equal(version.stdout, "skilled version phase4-test\n");
  for (const args of [
    [],
    ["--help"],
    ["debug", "--help"],
    ["debug"],
    ["completion"],
  ]) {
    const out = await run(dir, args);
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /Usage:/);
  }
  const bad = await run(dir, ["validate", "--unknown"]);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /unknown option/);
  assert.match(bad.stderr, /Usage:/);
});
test("init prints exact source template with branded names", async (t) => {
  const dir = await temp(t);
  const out = await run(dir, ["init", "--print"]);
  assert.equal(out.code, 0, out.stderr);
  assert.equal(out.stdout, initTemplateContent);
  assert.equal(parse(out.stdout).kind, "SkilledConfig");
});
test("init creates private local file, refuses overwrite, honors explicit false and force", async (t) => {
  const dir = await temp(t);
  let out = await run(dir, ["init", "--local"]);
  assert.equal(out.code, 0, out.stderr);
  assert.equal(
    (await stat(path.join(dir, ".skilled.yaml"))).mode & 0o777,
    0o600,
  );
  out = await run(dir, ["init", "--local", "--force=false"]);
  assert.equal(out.code, 1);
  assert.match(out.stderr, /already exists/);
  out = await run(dir, ["init", "--local=true", "--force=true"]);
  assert.equal(out.code, 0, out.stderr);
  out = await run(dir, ["init", "--local=false"]);
  assert.equal(out.code, 0, out.stderr);
  assert.equal(
    await readFile(path.join(dir, "xdg/skilled/config.yaml"), "utf8"),
    initTemplateContent,
  );
});
test("init copies valid source verbatim preserving comments, rejects missing/invalid source", async (t) => {
  const dir = await temp(t),
    src = path.join(dir, "source.yaml"),
    text = "# keep comment\nkind: SkilledConfig\nschema_version: v1alpha1\n";
  await writeFile(src, text);
  let out = await run(dir, ["--config", src, "init", "--print"]);
  assert.equal(out.code, 0, out.stderr);
  assert.equal(out.stdout, text);
  out = await run(dir, ["init", "--config", src, "--local"]);
  assert.equal(out.code, 0, out.stderr);
  assert.equal(await readFile(path.join(dir, ".skilled.yaml"), "utf8"), text);
  for (const source of ["missing.yaml", "invalid.yaml"]) {
    if (source === "invalid.yaml")
      await writeFile(path.join(dir, source), "telemetry: [broken");
    out = await run(dir, ["init", "--config", source, "--print"]);
    assert.equal(out.code, 1);
  }
});
test("explicit corrupt config blocks commands; auto-discovered corrupt config warns and continues", async (t) => {
  const dir = await temp(t);
  await writeFile(path.join(dir, ".skilled.yaml"), "telemetry: [broken");
  let out = await run(dir, ["--version"]);
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stderr, /warning: ignoring project config/);
  out = await run(dir, ["--config", ".skilled.yaml", "--version"]);
  assert.equal(out.code, 1);
  assert.match(out.stderr, /parse config/);
});
for (const id of [0, 1, -1, 12345])
  test(`import case ID ${id}`, () => {
    const data = parseAnthropicEvals(
      JSON.stringify({
        skill_name: "sample",
        evals: [
          { id, prompt: "Do thing", files: ["a.txt"], expectations: ["works"] },
        ],
      }),
    );
    const c = convertEvalToCase(data.evals[0], data.skill_name);
    assert.equal(c.id, `case-${id}`);
    assert.equal(c.title, `sample - ${id}`);
    assert.deepEqual(c.context.files, { "a.txt": "a.txt" });
    assert.deepEqual(c.judge.criteria, ["works"]);
    assert.equal(c.judge.model, "anthropic/claude-sonnet-4-6");
  });
for (const json of [
  "[1]",
  '{"evals":{}}',
  '{"skill_name":1}',
  '{"evals":[{"id":1.2}]}',
  '{"evals":[{"files":[3]}]}',
])
  test(`Anthropic rejects bad input ${json}`, () =>
    assert.throws(() => parseAnthropicEvals(json)));
test("import creates reloadable cases, roots paths at SKILL.md and preserves no files case", async (t) => {
  const dir = await temp(t);
  await writeFile(path.join(dir, "SKILL.md"), "---\nname: example\n---\n");
  await mkdir(path.join(dir, "nested"));
  const src = path.join(dir, "source.json");
  await writeFile(
    src,
    JSON.stringify({
      skill_name: "example",
      evals: [
        {
          id: 7,
          prompt: "one",
          expected_output: "works",
          files: ["input.txt"],
          expectations: ["one"],
        },
        { id: 9, prompt: "two", expectations: ["two"] },
      ],
    }),
  );
  const out = await run(dir, ["import", src, "--output", "nested/evals"]);
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stdout, /Total: 2 cases imported/);
  const cfg = parse(
    await readFile(path.join(dir, "nested/evals/eval.yaml"), "utf8"),
  );
  assert.deepEqual(cfg.cases.files, [
    "nested/evals/cases/case-7.yaml",
    "nested/evals/cases/case-9.yaml",
  ]);
  assert.deepEqual(cfg.skills, [{ source: "local_path", path: "." }]);
  const c = parse(
    await readFile(path.join(dir, "nested/evals/cases/case-9.yaml"), "utf8"),
  );
  assert.deepEqual(c.context, {});
  assert.equal(c.id, "case-9");
  const valid = await run(dir, ["validate", "nested/evals/eval.yaml"]);
  assert.equal(valid.code, 0, valid.stderr);
  assert.match(valid.stdout, /loaded 2 case/);
  const list = await run(dir, ["list-cases", "nested/evals/eval.yaml"]);
  assert.equal(list.code, 0, list.stderr);
  assert.match(list.stdout, /case-7\s+example - 7\s+functional_test\s+one/);
});
test("import root, fallback and empty list prefixes", async (t) => {
  const dir = await temp(t);
  assert.equal(
    await computeOutputRelPrefix(path.join(dir, "unmarked")),
    "unmarked",
  );
  await writeFile(path.join(dir, "SKILL.md"), "skill");
  assert.equal(await computeOutputRelPrefix(dir), "");
  const cfg = await generateEvalConfig([], dir);
  assert.deepEqual(cfg.cases.files, []);
  assert.deepEqual((await generateEvalConfig(["case-9"], dir)).cases.files, [
    "cases/case-9.yaml",
  ]);
});
for (const fixture of ["missing", "bad", "no-name"])
  test(`import rejects ${fixture}`, async (t) => {
    const dir = await temp(t);
    if (fixture !== "missing")
      await writeFile(
        path.join(dir, "evals.json"),
        fixture === "bad" ? "{" : '{"evals":[]}',
      );
    const out = await run(dir, ["import", "evals.json"]);
    assert.equal(out.code, 1);
    assert.match(
      out.stderr,
      fixture === "missing"
        ? /failed to read/
        : fixture === "bad"
          ? /failed to parse/
          : /skill_name/,
    );
  });
test("list unicode truncation uses Unicode code points and fallback labels", () => {
  const c = decode<CaseConfig>("CaseConfig", {
    id: "x",
    input: { prompt: "😀".repeat(51) },
  });
  const text = formatCaseTable([c]);
  assert.match(text, /x\s+x\s+functional_test/);
  assert.ok(text.endsWith("😀".repeat(47) + "...\n"));
});
async function reportFixture(dir: string): Promise<string> {
  const file = path.join(dir, "result.json");
  await writeFile(
    file,
    JSON.stringify({
      skill_name: "example",
      schema_version: "v1alpha1",
      engine_name: "custom",
      model_name: "local",
      case_results: [
        {
          case_id: "a",
          title: "Pass",
          status: "PASS",
          duration_ms: 10,
          turns: 1,
          grading: null,
        },
        {
          case_id: "b",
          title: "Fail",
          status: "FAIL",
          duration_ms: 20,
          turns: 1,
          grading: null,
        },
      ],
    }),
  );
  return file;
}
test("offline report generates every real format into new directory and correct summary", async (t) => {
  const dir = await temp(t),
    file = await reportFixture(dir),
    out = await run(dir, [
      "report",
      file,
      "--output-dir",
      "reports",
      "--format",
      "json",
      "--format",
      "junit",
      "--format",
      "html",
      "--format",
      "markdown",
    ]);
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stdout, /Pass rate: 50.0% \(1\/2 cases\)/);
  const json = JSON.parse(
    await readFile(path.join(dir, "reports/report.json"), "utf8"),
  );
  assert.equal(json.case_results.length, 2);
  assert.match(
    await readFile(path.join(dir, "reports/report.xml"), "utf8"),
    /failures="1"/,
  );
  assert.match(
    await readFile(path.join(dir, "reports/report.html"), "utf8"),
    /<!DOCTYPE html>/i,
  );
  assert.match(
    await readFile(path.join(dir, "reports/report.md"), "utf8"),
    /example/,
  );
});
for (const format of ["json", "junit", "html"])
  test(`debug report ${format} generates real file and stderr summary`, async (t) => {
    const dir = await temp(t),
      file = await reportFixture(dir),
      out = await run(dir, ["debug", "report", file, "--format", format]);
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stderr, /2 cases \(pass_rate: 50%\)/);
    assert.equal(out.stdout, "");
    assert.ok(
      (
        await stat(
          path.join(
            dir,
            format === "json"
              ? "report.json"
              : format === "junit"
                ? "report.xml"
                : "report.html",
          ),
        )
      ).size > 0,
    );
  });
for (const args of [
  ["report", "absent"],
  ["report", "invalid.json"],
  ["report", "result.json", "--format", "bad"],
  ["debug", "report", "result.json", "--format", "markdown"],
])
  test(`report rejects ${args.join(" ")}`, async (t) => {
    const dir = await temp(t);
    await reportFixture(dir);
    await writeFile(path.join(dir, "invalid.json"), "{");
    const out = await run(dir, args);
    assert.equal(out.code, 1);
  });
for (const raw of [
  "[]",
  '{"skill_name":1}',
  '{"case_results":{}}',
  '{"start_time":"yesterday"}',
  '{"case_results":[{"duration_ms":"x"}]}',
])
  test(`report JSON rejects wrong type ${raw}`, () =>
    assert.throws(() => parseReportInput(raw)));
test("debug rule judge runs real assertions, expectation gate and optional report", async (t) => {
  const dir = await temp(t),
    file = path.join(dir, "input.json");
  const base = {
    case_id: "one",
    final_message: "real output",
    exit_code: 0,
    turns_executed: 1,
    turns_total: 1,
    expect: { must_contain: ["real"] },
    judge: {
      type: "rule_based",
      success: [{ output_contains: { all: ["output"] } }],
    },
  };
  await writeFile(file, JSON.stringify(base));
  let out = await run(dir, ["debug", "judge", file, "--report", "html"]);
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stderr, /\[expect\] PASS/);
  assert.equal(
    JSON.parse(await readFile(path.join(dir, "grading.json"), "utf8")).status,
    "PASS",
  );
  assert.ok((await stat(path.join(dir, "report.html"))).size > 0);
  await writeFile(
    file,
    JSON.stringify({ ...base, expect: { must_contain: ["absent"] } }),
  );
  out = await run(dir, ["debug", "judge", file]);
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stderr, /judge skipped/);
  assert.equal(
    JSON.parse(await readFile(path.join(dir, "grading.json"), "utf8")).status,
    "FAIL",
  );
});
test("debug script judge launches real executable with readable transcript and removes transient file", async (t) => {
  const dir = await temp(t),
    script = path.join(dir, "judge.sh"),
    seen = path.join(dir, "seen.txt");
  await writeFile(
    script,
    `#!/bin/sh\nprintf '%s' "$EVAL_TRANSCRIPT_PATH" > '${seen}'\nnode -e 'const fs=require("node:fs");const t=JSON.parse(fs.readFileSync(process.env.EVAL_TRANSCRIPT_PATH,"utf8"));if(t[0].content!=="real turn")process.exit(3);console.log(JSON.stringify({status:"PASS",assertion_results:[{text:"transcript",passed:true,evidence:"read real transcript"}],summary:{passed:1,failed:0,total:1,pass_rate:1}}));'\n`,
    { mode: 0o700 },
  );
  const file = path.join(dir, "script.json");
  await writeFile(
    file,
    JSON.stringify({
      case_id: "script",
      transcript: [{ role: "user", content: "real turn", turn: 1 }],
      judge: { type: "script", script_path: script },
    }),
  );
  const out = await run(dir, ["debug", "judge", file]);
  assert.equal(out.code, 0, out.stderr);
  assert.equal(
    JSON.parse(await readFile(path.join(dir, "grading.json"), "utf8")).status,
    "PASS",
  );
  await assert.rejects(stat(await readFile(seen, "utf8")));
});
const reference = JSON.parse(
  await readFile(
    new URL("../../../tests/cli/reference-commands.json", import.meta.url),
    "utf8",
  ),
) as {
  source: string;
  decoding: {
    input: string;
    command: { args: string[]; code: number };
    output: unknown;
  }[];
  imported: unknown;
  commands: { args: string[]; code: number; stdout: string; stderr: string }[];
  files: Record<string, unknown>;
  judges: {
    input: unknown;
    command: { args: string[]; code: number; stdout: string; stderr: string };
    grading: unknown;
  }[];
  reportInput: unknown;
  reports: {
    format: string;
    command: { args: string[]; code: number; stdout: string; stderr: string };
    content: string;
  }[];
};
test("actual pinned Go import, validation and listing command outputs match", async (t) => {
  const dir = await temp(t);
  assert.equal(reference.source, "12deb53a19147704e3f547602962edf6d22e0c54");
  await writeFile(path.join(dir, "SKILL.md"), "---\nname: oracle\n---\n");
  await writeFile(
    path.join(dir, "evals.json"),
    JSON.stringify(reference.imported),
  );
  for (const expected of reference.commands) {
    const actual = await run(dir, expected.args);
    assert.equal(actual.code, expected.code, actual.stderr);
    assert.equal(actual.stdout.replaceAll(dir, "<DIR>"), expected.stdout);
    assert.equal(actual.stderr.replaceAll(dir, "<DIR>"), expected.stderr);
  }
  for (const [file, expected] of Object.entries(reference.files))
    assert.deepEqual(
      parse(await readFile(path.join(dir, file), "utf8")),
      expected,
      file,
    );
});
for (const [i, referenceJudge] of reference.judges.entries())
  test(`actual pinned Go debug judge output ${i}`, async (t) => {
    const dir = await temp(t);
    await writeFile(
      path.join(dir, "judge.json"),
      JSON.stringify(referenceJudge.input),
    );
    const out = await run(dir, referenceJudge.command.args);
    assert.equal(out.code, referenceJudge.command.code, out.stderr);
    assert.equal(out.stderr, referenceJudge.command.stderr);
    assert.equal(out.stdout, referenceJudge.command.stdout);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(dir, "grading.json"), "utf8")),
      referenceJudge.grading,
    );
  });
for (const referenceReport of reference.reports)
  test(`actual pinned Go offline ${referenceReport.format} report matches bytes`, async (t) => {
    const dir = await temp(t);
    await writeFile(
      path.join(dir, "result.json"),
      JSON.stringify(reference.reportInput),
    );
    const out = await run(dir, referenceReport.command.args);
    assert.equal(out.code, referenceReport.command.code, out.stderr);
    assert.equal(out.stdout, referenceReport.command.stdout);
    assert.equal(out.stderr, referenceReport.command.stderr);
    const ext =
      referenceReport.format === "json"
        ? "json"
        : referenceReport.format === "junit"
          ? "xml"
          : "md";
    const content = await readFile(
      path.join(dir, "reports/report." + ext),
      "utf8",
    );
    assert.equal(content, referenceReport.content);
  });
test("required config value named as a flag is preserved by argument normalization", async (t) => {
  const dir = await temp(t);
  const content = "# literal filename\nkind: SkilledConfig\n";
  await writeFile(path.join(dir, "--verbose"), content);
  const out = await run(dir, ["--config", "--verbose", "init", "--print"]);
  assert.equal(out.code, 0, out.stderr);
  assert.equal(out.stdout, content);
});
test("explicit boolean repetition obeys last value, false does not consume positional argument", async (t) => {
  const dir = await temp(t);
  let out = await run(dir, [
    "init",
    "--local",
    "--print=true",
    "--print=false",
  ]);
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stdout, /wrote/);
  out = await run(dir, ["init", "--print=false", "--print=true"]);
  assert.equal(out.code, 0, out.stderr);
  assert.equal(out.stdout, initTemplateContent);
  out = await run(dir, ["init", "--print=bogus"]);
  assert.equal(out.code, 1);
  assert.match(out.stderr, /invalid argument/);
});
test("run accepts original alias, verbosity cluster and explicit boolean false syntax", async (t) => {
  const dir = await temp(t);
  await writeFile(path.join(dir, "SKILL.md"), "---\nname: flags\n---\n");
  await writeFile(
    path.join(dir, "evals.json"),
    JSON.stringify({
      skill_name: "flags",
      evals: [{ id: 1, prompt: "one", expectations: ["one"] }],
    }),
  );
  const imported = await run(dir, [
    "import",
    "evals.json",
    "--output",
    "evals",
  ]);
  assert.equal(imported.code, 0, imported.stderr);
  for (const flags of [
    ["-vv", "--rk", "extra=value", "--ek=extra=value"],
    ["--verbose=false", "--no-delete=false", "--baseline=false"],
    ["--verbose=2", "--dry-run=true"],
  ]) {
    const out = await run(dir, [
      "run",
      "evals/eval.yaml",
      "--dry-run",
      ...flags,
    ]);
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /Would run/);
  }
});

for (const [i, vector] of reference.decoding.entries())
  test(`actual Go recursive JSON decoding ${i}`, async (t) => {
    const dir = await temp(t);
    await writeFile(path.join(dir, "decode.json"), vector.input);
    const out = await run(dir, vector.command.args);
    assert.equal(out.code, vector.command.code, out.stderr);
    if (out.code === 0)
      assert.deepEqual(
        JSON.parse(
          await readFile(path.join(dir, "decoded/report.json"), "utf8"),
        ),
        vector.output,
      );
  });
test("completion scripts for all original shells and no-description variants are generated", async (t) => {
  const dir = await temp(t);
  for (const shell of ["bash", "zsh", "fish", "powershell"])
    for (const suffix of [
      [],
      ["--no-descriptions"],
      ["--no-descriptions=false"],
    ]) {
      const out = await run(dir, ["completion", shell, ...suffix]);
      assert.equal(out.code, 0, out.stderr);
      assert.match(out.stdout, /skilled/);
      assert.match(out.stdout, /__complete/);
      if (suffix[0] === "--no-descriptions")
        assert.match(out.stdout, /__completeNoDesc/);
    }
});
test("hidden completion provides command/flag candidates and default file directives", async (t) => {
  const dir = await temp(t);
  for (const [args, names, directive] of [
    [["__completeNoDesc", "deb"], ["debug"], 4],
    [["__complete", "debug", ""], ["judge", "report"], 4],
    [["__completeNoDesc", "run", "--runtime", ""], [], 0],
    [
      ["__completeNoDesc", "init", "--local", "--"],
      ["--config", "--force", "--help", "--print"],
      4,
    ],
    [["__completeNoDesc", "run", "--dry"], ["--dry-run"], 4],
  ] as [string[], string[], number][]) {
    const out = await run(dir, args);
    assert.equal(out.code, 0, out.stderr);
    assert.deepEqual(
      out.stdout
        .trimEnd()
        .split("\n")
        .map((line) => line.split("\t")[0]),
      [...names, `:${directive}`],
    );
  }
});
test(
  "bash completion loads and calls the real CLI; zsh completion loads into compinit",
  {
    skip: !existsSync("/bin/zsh")
      ? "zsh is unavailable on this host; shell loading verified separately on macOS"
      : false,
  },
  async (t) => {
    const dir = await temp(t),
      bin = path.join(dir, "skilled"),
      bashFile = path.join(dir, "completion.bash"),
      zshFile = path.join(dir, "completion.zsh");
    const q = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
    await writeFile(
      bin,
      `#!/bin/sh\nexec ${q(process.execPath)} ${q(driver)} "$@"\n`,
      { mode: 0o700 },
    );
    await writeFile(bashFile, (await run(dir, ["completion", "bash"])).stdout);
    await writeFile(zshFile, (await run(dir, ["completion", "zsh"])).stdout);
    const invoke = async (shell: string, script: string) =>
      new Promise<{ code: number | null; stdout: string; stderr: string }>(
        (resolve, reject) => {
          const child = spawn(shell, ["-c", script], {
            cwd: dir,
            env: {
              PATH: process.env.PATH,
              HOME: dir,
              OTEL_TRACES_EXPORTER: "none",
              OTEL_METRICS_EXPORTER: "none",
            },
          });
          let stdout = "",
            stderr = "";
          child.stdout.on("data", (x) => (stdout += x));
          child.stderr.on("data", (x) => (stderr += x));
          child.on("error", reject);
          child.on("close", (code) => resolve({ code, stdout, stderr }));
        },
      );
    const bash = await invoke(
      "/bin/bash",
      `source ${q(bashFile)}; words=(${q(bin)} deb); cword=1; cur=deb; __skilled_get_completion_results; printf '%s\\n%s\\n' "$out" "$directive"`,
    );
    assert.equal(bash.code, 0, bash.stderr);
    assert.match(bash.stdout, /debug\tDebug commands/);
    assert.match(bash.stdout, /\n4\n$/);
    const zsh = await invoke(
      "/bin/zsh",
      `autoload -Uz compinit; compinit -D; source ${q(zshFile)}; (( $+functions[_skilled] )) || exit 7; ${q(bin)} __completeNoDesc deb`,
    );
    assert.equal(zsh.code, 0, zsh.stderr);
    assert.equal(zsh.stdout, "debug\n:4\n");
  },
);

test("root version option does not leak into subcommands", async (t) => {
  const dir = await temp(t);
  for (const args of [
    ["init", "--version"],
    ["init", "-v"],
    ["run", "-V"],
  ]) {
    const out = await run(dir, args);
    assert.equal(out.code, 1);
    assert.match(out.stderr, /unknown option/);
  }
});

test("offline report singleton empty format selects source JSON default", async (t) => {
  const dir = await temp(t);
  await reportFixture(dir);
  const out = await run(dir, ["report", "result.json", "--format", ""]);
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stdout, /Generated json report/);
  assert.ok((await stat(path.join(dir, "report.json"))).size > 0);
  const mixed = await run(dir, [
    "report",
    "result.json",
    "--format",
    "",
    "--format",
    "json",
  ]);
  assert.equal(mixed.code, 1);
  assert.match(mixed.stderr, /unsupported report format/);
});
