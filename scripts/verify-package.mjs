import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { execFileSync } from "node:child_process";

// This function is serialized into the extracted installation. It must have no
// closure over checkout files, dependencies, or the invoking Node executable.
async function installationProbe() {
  const { default: assert } = await import("node:assert/strict");
  const { mkdtemp, mkdir, writeFile, readFile, readdir, rm } = await import(
    "node:fs/promises"
  );
  const { tmpdir } = await import("node:os");
  const { join, dirname, delimiter } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { spawnSync } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const install = dirname(fileURLToPath(import.meta.url));
  const { PRODUCT, WORKFLOW_SKILL, config, regex, execute } = await import(
    "./app/dist/src/index.js"
  );
  const metadata = JSON.parse(
    await readFile(join(install, "installation.json"), "utf8"),
  );
  assert.equal(PRODUCT, "skilled");
  assert.equal(WORKFLOW_SKILL, "skilled-improve");
  assert.equal(metadata.fullCLI, true, "Archive must contain the complete CLI");
  assert.equal(
    (await config.defaultEvalConfig()).cases.defaults.timeout_seconds,
    300,
  );
  assert.equal(regex.regexMatches("a+", "aaa"), true);
  const root = await mkdtemp(join(tmpdir(), "skilled external ü "));
  const priorCwd = process.cwd();
  try {
    await mkdir(join(root, "home"));
    await mkdir(join(root, "evals/cases"), { recursive: true });
    await writeFile(
      join(root, "SKILL.md"),
      "---\nname: skilled-improve\ndescription: Bundled CLI acceptance\n---\nCompute a SHA256 digest of the requested input.\n",
    );
    const worker = [
      "const fs = require('node:fs');",
      "const crypto = require('node:crypto');",
      "const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));",
      "const prompt = input.messages.filter(m => m.role === 'user').at(-1)?.content || '';",
      "const digest = crypto.createHash('sha256').update(prompt).digest('hex');",
      "fs.mkdirSync('results', {recursive:true});",
      "fs.writeFileSync('results/digest.txt', digest);",
      "console.log(JSON.stringify({exit_code:0, final_message:digest, session_id:'packaged-session', transcript:[{role:'assistant', content:digest}], artifacts:{generated_files:['results/digest.txt']}}));",
    ].join("\n");
    const cases = [
      {
        id: "package-pass",
        title: "Real bundled hash",
        input: { prompt: "packaged-ü-input" },
        judge: {
          type: "rule_based",
          success: [{ output_matches: { all: ["^[0-9a-f]{64}$"] } }],
        },
      },
      {
        id: "package-fail",
        title: "Real negative verdict",
        input: { prompt: "negative-case" },
        judge: {
          type: "rule_based",
          success: [{ output_contains: { all: ["not-a-sha256-digest"] } }],
        },
      },
    ];
    for (const c of cases) {
      c.context = { files: { "engine.cjs": worker } };
      c.constraints = { timeout_seconds: 30, max_turns: 1 };
      c.collect_artifacts = ["results/**"];
      await writeFile(
        join(root, "evals/cases", `${c.id}.yaml`),
        JSON.stringify(c),
      );
    }
    const evalPath = join(root, "evals/eval.yaml");
    await writeFile(
      evalPath,
      JSON.stringify({
        schema_version: "v1alpha1",
        environment: { type: "none" },
        engine: {
          name: "packaged-hash",
          custom: {
            transport: "local",
            response_format: "session_result",
            local: { command: "node", args: ["engine.cjs", "${input_file}"] },
          },
        },
        cases: {
          files: cases.map((c) => `evals/cases/${c.id}.yaml`),
          retry_policy: { max_retries: 0 },
        },
      }),
    );
    const env = {
      PATH: [dirname(process.execPath), process.env.PATH || ""].join(delimiter),
      HOME: join(root, "home"),
      USERPROFILE: join(root, "home"),
      OTEL_SDK_DISABLED: "true",
    };
    for (const key of [
      "SystemRoot",
      "SYSTEMROOT",
      "COMSPEC",
      "TEMP",
      "TMP",
      "TMPDIR",
    ])
      if (process.env[key]) env[key] = process.env[key];
    const bootstrap = join(install, "app/dist/src/bootstrap.js");
    const run = (args) =>
      spawnSync(
        process.platform === "win32"
          ? process.execPath
          : join(install, "skilled"),
        process.platform === "win32" ? [bootstrap, ...args] : args,
        {
          cwd: root,
          env:
            process.platform === "win32"
              ? env
              : { ...env, PATH: process.env.PATH || "/usr/bin:/bin" },
          encoding: "utf8",
          timeout: 120_000,
        },
      );
    const agentInstructions = "# Existing project instructions\nPreserve this policy.\n";
    await writeFile(join(root, "AGENTS.md"), agentInstructions);
    for (const [host, folder] of [["codex", ".agents"], ["claude-code", ".claude"]]) {
      const existingSkill = join(root, folder, "skills/existing-policy/SKILL.md");
      await mkdir(join(root, folder, "skills/existing-policy"), { recursive: true });
      await writeFile(existingSkill, "Existing user policy\n");
      let previousManifest;
      for (let attempt = 0; attempt < 2; attempt++) {
        const setup = run(["setup", "--host", host]);
        assert.equal(setup.status, 0, setup.stderr);
        const manifest = await readFile(join(root, folder, "skills/skilled-improve/.skilled-install.json"), "utf8");
        assert.equal(JSON.parse(manifest).version, metadata.version);
        if (previousManifest) assert.equal(manifest, previousManifest, "Repeated setup must preserve the workflow contents");
        previousManifest = manifest;
      }
      const installedSkill = join(root, folder, "skills/skilled-improve/SKILL.md");
      assert.match(await readFile(installedSkill, "utf8"), /name: skilled-improve/);
      assert.match(await readFile(join(root, folder, "skills/skilled-improve/references/install.md"), "utf8"), /https:\/\/deadhead04\.github\.io\/skillEd\/guide\/installation/);
      const pristine = await readFile(installedSkill, "utf8");
      await writeFile(installedSkill, pristine + "\nLocal user customization\n");
      for (const args of [["setup", "--host", host], ["setup", "--host", host, "--remove"]]) {
        const protectedEdit = run(args);
        assert.notEqual(protectedEdit.status, 0, "Setup must protect locally edited workflows");
        assert.match(protectedEdit.stderr, /local changes/);
        assert.equal(await readFile(installedSkill, "utf8"), pristine + "\nLocal user customization\n");
      }
      await writeFile(installedSkill, pristine);
      const removed = run(["setup", "--host", host, "--remove"]);
      assert.equal(removed.status, 0, removed.stderr);
      await assert.rejects(readFile(installedSkill), { code: "ENOENT" });
      assert.equal(run(["setup", "--host", host, "--remove"]).status, 0);
      assert.equal(await readFile(existingSkill, "utf8"), "Existing user policy\n");
      assert.equal(await readFile(join(root, "AGENTS.md"), "utf8"), agentInstructions);
      assert.equal((await readdir(join(root, folder, "skills"))).some(name => name.startsWith(".skilled-setup-")), false);

    }
    const validated = run(["validate", evalPath]);
    assert.equal(validated.status, 0, validated.stderr);
    const sourceValidated = run(["validate", "--skill", root]);
    assert.equal(sourceValidated.status, 0, sourceValidated.stderr);
    const output = join(root, "cli-output"),
      events = join(root, "cli-events.jsonl");
    const invocation = run([
      "run",
      evalPath,
      "--output-dir",
      output,
      "--format",
      "json",
      "--format",
      "junit",
      "--format",
      "html",
      "--event-log",
      events,
    ]);
    assert.equal(invocation.status, 1, invocation.stdout + invocation.stderr);
    assert.match(invocation.stderr, /one or more cases failed/);
    const report = JSON.parse(
      await readFile(join(output, "iteration-1/report.json"), "utf8"),
    );
    assert.equal(report.skill_name, "skilled-improve");
    assert.equal(report.case_results.length, 2);
    for (const c of report.case_results) {
      assert.equal(c.status, c.case_id === "package-pass" ? "PASS" : "FAIL");
      const prompt = cases.find((item) => item.id === c.case_id).input.prompt;
      assert.equal(
        c.response,
        createHash("sha256").update(prompt).digest("hex"),
      );
      assert.equal(
        await readFile(
          join(
            output,
            "iteration-1",
            c.case_id,
            c.configuration,
            "outputs/agent/run/digest.txt",
          ),
          "utf8",
        ),
        c.response,
      );
      assert.equal(
        await readFile(
          join(
            output,
            "iteration-1",
            c.case_id,
            c.configuration,
            "outputs/workspace/results/digest.txt",
          ),
          "utf8",
        ),
        c.response,
      );
    }
    const junit = await readFile(
      join(output, "iteration-1/report.xml"),
      "utf8",
    );
    assert.match(junit, /tests="2"/);
    assert.match(junit, /failures="1"/);
    const html = await readFile(
      join(output, "iteration-1/report.html"),
      "utf8",
    );
    assert.match(html, /skilled-improve/);
    assert.match(html, /package-pass/);
    assert.match(html, /package-fail/);
    const records = (await readFile(events, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(records[0].event, "run_started");
    assert.equal(records.at(-1).event, "run_finished");
    assert.equal(records.at(-1).payload.status, "COMPLETED");
    assert.equal(records.at(-1).last_event, true);
    assert.equal(records.filter((r) => r.event === "case_completed").length, 2);

    const comparison = run(["compare", join(output, "iteration-1/report.json"),
      join(output, "iteration-1/report.json"), "--format", "json", "--fail-on-regression"]);
    assert.equal(comparison.status, 0, comparison.stderr);
    assert.equal(JSON.parse(comparison.stdout).summary.matched, 2);

    // Resolve the SDK from this installation, never the checkout or system Node.
    const { Client } = await import(new URL("./app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js", import.meta.url));
    const { StdioClientTransport } = await import(new URL("./app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js", import.meta.url));
    const client = new Client({ name: "skilled-archive-acceptance", version: "1.0.0" });
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [bootstrap, "mcp", "--workspace", root], cwd: root, env, stderr: "pipe" });
    try {
      await client.connect(transport);
      const names = (await client.listTools()).tools.map(tool => tool.name);
      for (const name of ["skilled_validate_skill", "skilled_validate", "skilled_compare", "skilled_run"])
        assert(names.includes(name), `Missing packaged MCP tool ${name}`);
      const workflow = await client.readResource({ uri: "skilled://workflow/skilled-improve" });
      assert.match(workflow.contents[0].text, /name: skilled-improve/);
      const resources = (await client.listResources()).resources;
      assert(resources.some(resource => resource.uri.endsWith("/references/eval-yaml.md")));
      const template = await client.readResource({ uri: "skilled://workflow/skilled-improve/assets/case.yaml.tmpl" });
      assert.match(template.contents[0].text, /input:/);
      assert((await client.getPrompt({ name: "skilled-improve" })).messages.length > 0);
      for (const name of ["skilled_validate_skill", "skilled_validate", "skilled_run"]) {
        const result = await client.callTool({ name, arguments: { path: "." } });
        assert.equal(result.isError, false, JSON.stringify(result));
      }
      const same = await client.callTool({ name: "skilled_compare", arguments: {
        before: "cli-output/iteration-1/report.json", after: "cli-output/iteration-1/report.json" } });
      assert.equal(same.isError, false, JSON.stringify(same));
      assert.equal(JSON.parse(same.content[0].text).summary.regressions, 0);
    } finally { await client.close(); }

    // Call the package's public API from a separate workspace and preserve the
    // same environment isolation as the executable probe.
    process.chdir(root);
    Object.assign(process.env, env);
    const apiOutput = join(root, "api-output"),
      apiEvents = join(root, "api-events.jsonl");
    let stdout = "",
      stderr = "";
    await execute(
      metadata.version,
      [
        "run",
        evalPath,
        "--include-case-name",
        "package-pass",
        "--output-dir",
        apiOutput,
        "--format",
        "json",
        "--event-log",
        apiEvents,
      ],
      {
        stdout: (text) => {
          stdout += text;
        },
        stderr: (text) => {
          stderr += text;
        },
      },
    );
    const apiReport = JSON.parse(
      await readFile(join(apiOutput, "iteration-1/report.json"), "utf8"),
    );
    assert.equal(apiReport.case_results.length, 1, stdout + stderr);
    assert.equal(apiReport.case_results[0].status, "PASS");
    assert.equal(
      JSON.parse((await readFile(apiEvents, "utf8")).trim().split("\n").at(-1))
        .payload.status,
      "COMPLETED",
    );

    const bundled = join(install, "app/dist/bundled-plugins"),
      canonical = await readFile(
        join(install, "app/skills/skilled-improve/SKILL.md"),
        "utf8",
      );
    for (const host of ["codex", "dsh"]) {
      const plugin = join(bundled, `${host}-skilled`);
      assert.equal(
        await readFile(
          join(
            plugin,
            host === "codex"
              ? "skills/skilled-improve/SKILL.md"
              : "dist/skilled-improve/SKILL.md",
          ),
          "utf8",
        ),
        canonical,
      );
      const schema = JSON.parse(
        await readFile(
          join(
            plugin,
            host === "codex"
              ? "schemas/skill-observation/v1alpha1/observation.schema.json"
              : "dist/skill-observation/v1alpha1/observation.schema.json",
          ),
          "utf8",
        ),
      );
      assert.equal(schema.type, "object");
      if (host === "dsh") {
        assert.equal(
          JSON.parse(await readFile(join(plugin, "package.json"), "utf8")).name,
          "dsh-skilled",
        );
        assert(
          (await readFile(join(plugin, "index.js"), "utf8")).includes(
            "skilled_validate",
          ),
        );
      } else {
        assert.equal(
          JSON.parse(
            await readFile(join(plugin, ".codex-plugin/plugin.json"), "utf8"),
          ).name,
          "codex-skilled",
        );
        assert.deepEqual(await readdir(join(plugin, "skills")), [
          "skilled-improve",
        ]);
        const mcp = spawnSync(
          process.execPath,
          [join(plugin, "scripts/observer.js"), "mcp"],
          {
            cwd: root,
            env,
            input: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n',
            encoding: "utf8",
            timeout: 10_000,
          },
        );
        assert.equal(mcp.status, 0, mcp.stderr);
        assert.equal(JSON.parse(mcp.stdout).result.tools.length, 8);
      }
    }
    console.log(
      JSON.stringify({
        probe: "full-cli-and-public-api",
        passed: true,
        cliCases: 2,
        apiCases: 1,
        formats: ["json", "junit", "html"],
        events: records.length,
        plugins: ["codex-skilled", "dsh-skilled"],
        mcp: ["stdio", "tools", "workflow", "references", "templates", "prompt"],
        setupHosts: ["codex", "claude-code"],
        setup: ["install", "repeat", "protect-local-edits", "remove", "preserve-existing-skills-and-instructions"],
        cwdOutsideCheckout: true,
        systemNodeRequired: false,
      }),
    );
  } finally {
    process.chdir(priorCwd);
    await rm(root, { recursive: true, force: true });
  }
}

const archive = resolve(process.argv[2] || "");
if (!process.argv[2] || !/\.(tar\.gz|zip)$/.test(archive))
  throw new Error(
    "Usage: node scripts/verify-package.mjs <archive.tar.gz|archive.zip> [--docker]",
  );
const hash = createHash("sha256");
for await (const chunk of createReadStream(archive)) hash.update(chunk);
if (
  hash.digest("hex") !==
  (await readFile(`${archive}.sha256`, "utf8")).split(/\s+/)[0]
)
  throw new Error("Archive checksum mismatch");
const temp = await mkdtemp(join(tmpdir(), "skilled install ü "));
try {
  if (archive.endsWith(".zip")) {
    if (process.platform === "win32") {
      const quote = (text) => `'${text.replaceAll("'", "''")}'`;
      execFileSync("powershell.exe", [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(temp)}`,
      ]);
    } else execFileSync("unzip", ["-q", archive, "-d", temp]);
  } else execFileSync("tar", ["-xzf", archive, "-C", temp]);
  const entries = await readdir(temp);
  if (entries.length !== 1)
    throw new Error("Archive must contain exactly one installation directory");
  const install = join(temp, entries[0]);
  const metadata = JSON.parse(
    await readFile(join(install, "installation.json"), "utf8"),
  );
  await writeFile(
    join(install, "verify.mjs"),
    `await (${installationProbe.toString()})();\n`,
  );
  if (process.argv.includes("--docker")) {
    if (!metadata.target.startsWith("linux-"))
      throw new Error("Docker verification requires Linux artifact");
    const platform = metadata.target.endsWith("arm64")
      ? "linux/arm64"
      : "linux/amd64";
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--platform",
        platform,
        "-v",
        `${install}:/installation:ro`,
        "-w",
        "/tmp",
        "debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587",
        "/bin/sh",
        "-ec",
        'if command -v node; then echo "Unexpected system Node"; exit 1; fi; /installation/skilled --version; /installation/runtime/bin/node /installation/verify.mjs',
      ],
      { stdio: "inherit", timeout: 240_000 },
    );
  } else {
    if (metadata.target !== `${process.platform}-${process.arch}`)
      throw new Error("Archive does not match this host");
    const isWindows = process.platform === "win32";
    const env = {
      PATH: isWindows
        ? join(process.env.SystemRoot || "C:\\Windows", "System32")
        : "/usr/bin:/bin",
      OTEL_SDK_DISABLED: "true",
    };
    for (const key of [
      "SystemRoot",
      "SYSTEMROOT",
      "COMSPEC",
      "TEMP",
      "TMP",
      "TMPDIR",
    ])
      if (process.env[key]) env[key] = process.env[key];
    const version = isWindows
      ? execFileSync(
          process.env.COMSPEC || "cmd.exe",
          ["/d", "/s", "/c", `""${join(install, "skilled.cmd")}" --version"`],
          // The command string is already quoted for cmd.exe /s /c.
          { cwd: temp, env, encoding: "utf8", windowsVerbatimArguments: true },
        )
      : execFileSync(join(install, "skilled"), ["--version"], {
          cwd: temp,
          env,
          encoding: "utf8",
        });
    if (version.trim() !== `skilled version ${metadata.version}`)
      throw new Error("CLI version mismatch");
    process.stdout.write(version);
    execFileSync(
      join(install, isWindows ? "runtime/node.exe" : "runtime/bin/node"),
      [join(install, "verify.mjs")],
      { cwd: temp, env, stdio: "inherit", timeout: 240_000 },
    );
  }
  console.log(
    JSON.stringify({
      archive: basename(archive),
      target: metadata.target,
      verification: "passed",
      systemNodeRequired: false,
      fullCLI: metadata.fullCLI,
    }),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
