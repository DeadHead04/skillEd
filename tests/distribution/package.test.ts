import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, delimiter, dirname } from "node:path";
import { spawnSync } from "node:child_process";
const enabled = process.env.SKILLED_DISTRIBUTION_INTEGRATION === "1";
test(
  "Local npm tarball installs, runs globally and via npm exec, and exposes public API",
  { skip: !enabled, timeout: 240_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "skilled npm ü "));
    try {
      const local = join(root, "consumer"),
        prefix = join(root, "global"),
        home = join(root, "home");
      await mkdir(local);
      await mkdir(prefix);
      await mkdir(home);
      await writeFile(
        join(local, "package.json"),
        JSON.stringify({
          name: "skilled-local-acceptance",
          version: "1.0.0",
          private: true,
          type: "module",
        }),
      );
      const archive = resolve(
        process.env.SKILLED_DISTRIBUTION_NPM_ARCHIVE ||
          `artifacts/skilled-${JSON.parse(await readFile("package.json", "utf8")).version}.tgz`,
      );
      const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        HOME: home,
        USERPROFILE: home,
        OTEL_SDK_DISABLED: "true",
        npm_config_update_notifier: "false",
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
      const npm = (args: string[], cwd = local) => {
        const r = process.env.npm_execpath
          ? spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
              cwd,
              env,
              encoding: "utf8",
              timeout: 120_000,
            })
          : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
              cwd,
              env,
              encoding: "utf8",
              timeout: 120_000,
            });
        assert.equal(r.status, 0, r.stdout + r.stderr);
        return r.stdout;
      };
      npm(["install", "--ignore-scripts", "--no-audit", "--no-fund", archive]);
      npm([
        "install",
        "--global",
        "--prefix",
        prefix,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        archive,
      ]);
      await mkdir(join(local, "evals/cases"), { recursive: true });
      await writeFile(
        join(local, "SKILL.md"),
        "---\nname: npm-acceptance\ndescription: Real local npm package check\n---\nHash the request.\n",
      );
      const worker =
        "const fs=require('node:fs');const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));console.log(JSON.stringify({exit_code:0,final_message:require('node:crypto').createHash('sha256').update(input.messages.at(-1).content).digest('hex')}));";
      await writeFile(
        join(local, "evals/cases/pass.yaml"),
        JSON.stringify({
          id: "npm-pass",
          title: "Actual npm installed process",
          input: { prompt: "real-npm-input" },
          context: { files: { "engine.cjs": worker } },
          judge: {
            type: "rule_based",
            success: [{ output_matches: { all: ["^[0-9a-f]{64}$"] } }],
          },
        }),
      );
      await writeFile(
        join(local, "evals/eval.yaml"),
        JSON.stringify({
          schema_version: "v1alpha1",
          environment: { type: "none" },
          engine: {
            name: "npm-hash",
            custom: {
              transport: "local",
              response_format: "session_result",
              local: { command: "node", args: ["engine.cjs", "${input_file}"] },
            },
          },
          cases: { files: ["evals/cases/pass.yaml"] },
        }),
      );
      const globalBin = join(
        prefix,
        process.platform === "win32" ? "skilled.cmd" : "bin/skilled",
      );
      let global;
      if (process.platform === "win32")
        global = spawnSync(
          process.env.COMSPEC || "cmd.exe",
          [
            "/d",
            "/s",
            "/c",
            `""${globalBin}" run evals/eval.yaml --output-dir global-output --event-log global-events.jsonl"`,
          ],
          { cwd: local, env, encoding: "utf8", timeout: 60_000 },
        );
      else
        global = spawnSync(
          globalBin,
          [
            "run",
            "evals/eval.yaml",
            "--output-dir",
            "global-output",
            "--event-log",
            "global-events.jsonl",
          ],
          { cwd: local, env, encoding: "utf8", timeout: 60_000 },
        );
      assert.equal(global.status, 0, global.stdout + global.stderr);
      npm([
        "exec",
        "--offline",
        "--",
        "skilled",
        "run",
        "evals/eval.yaml",
        "--output-dir",
        "exec-output",
        "--event-log",
        "exec-events.jsonl",
      ]);
      await writeFile(
        join(local, "api.mjs"),
        "import {execute} from 'skilled/api';await execute('npm-acceptance',['run','evals/eval.yaml','--output-dir','api-output','--event-log','api-events.jsonl']);\n",
      );
      const api = spawnSync(process.execPath, ["api.mjs"], {
        cwd: local,
        env,
        encoding: "utf8",
        timeout: 60_000,
      });
      assert.equal(api.status, 0, api.stdout + api.stderr);
      for (const mode of ["global", "exec", "api"]) {
        const report = JSON.parse(
          await readFile(
            join(local, `${mode}-output/iteration-1/report.json`),
            "utf8",
          ),
        );
        assert.equal(report.case_results.length, 1);
        assert.equal(report.case_results[0].status, "PASS");
        assert.match(report.case_results[0].response, /^[0-9a-f]{64}$/);
        const events = (
          await readFile(join(local, `${mode}-events.jsonl`), "utf8")
        )
          .trim()
          .split("\n")
          .map((s) => JSON.parse(s));
        assert.equal(events.at(-1).payload.status, "COMPLETED");
      }
      const pkg = JSON.parse(
        await readFile(
          join(local, "node_modules/skilled/package.json"),
          "utf8",
        ),
      );
      assert.equal(pkg.name, "skilled");
      assert.equal(pkg.private, true);
      assert.match(
        await readFile(
          join(local, "node_modules/skilled/skills/skilled-improve/SKILL.md"),
          "utf8",
        ),
        /name: skilled-improve/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
