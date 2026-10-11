import assert from "node:assert/strict";
import test from "node:test";
import {
  symlinkSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
test(
  "Actual Codex host installs the local plugin in a disposable home",
  { skip: process.env.SKILLED_CODEX_PLUGIN_HOST_INTEGRATION !== "1" },
  () => {
    const root = mkdtempSync(join(tmpdir(), "skilled-codex-host-"));
    try {
      const home = join(root, "codex-home"),
        market = join(root, "market");
      mkdirSync(home);
      mkdirSync(join(market, ".agents/plugins"), { recursive: true });
      cpSync(
        "dist/bundled-plugins/codex-skilled",
        join(market, "plugins/codex-skilled"),
        { recursive: true },
      );
      writeFileSync(
        join(market, ".agents/plugins/marketplace.json"),
        JSON.stringify({
          name: "skilled-local-test",
          plugins: [
            {
              name: "codex-skilled",
              source: { source: "local", path: "./plugins/codex-skilled" },
              policy: { installation: "AVAILABLE", authentication: "ON_USE" },
              category: "Developer Tools",
            },
          ],
        }),
      );
      const env = {
        PATH: process.env.PATH,
        CODEX_HOME: home,
        SKILLED_OBSERVER_DATA: join(root, "observations"),
      };
      for (const args of [
        ["plugin", "marketplace", "add", market, "--json"],
        ["plugin", "add", "codex-skilled@skilled-local-test", "--json"],
        ["plugin", "list", "--json"],
      ]) {
        const result = spawnSync(
          process.env.SKILLED_CODEX_PLUGIN_HOST_BIN || "codex",
          args,
          { cwd: root, env, encoding: "utf8", timeout: 40_000 },
        );
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /codex-skilled|skilled-local-test/);
        if (args[1] === "list") {
          const data = JSON.parse(result.stdout);
          assert.equal(data.installed[0].name, "codex-skilled");
          assert.equal(data.installed[0].enabled, true);
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
test(
  "Workflow source shell assertion fixtures retain all 60 real process regressions",
  { skip: process.env.SKILLED_WORKFLOW_REGRESSION_INTEGRATION !== "1" },
  () => {
    const result = spawnSync(
      "python3",
      ["skills/skilled-improve/evals/test_regression_scripts.py"],
      { encoding: "utf8", timeout: 180_000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Ran 60 tests/);
    assert.match(result.stderr, /OK/);
  },
);

test(
  "Actual DSH services load plugin and execute session, process, job and review lifecycle",
  { skip: !process.env.SKILLED_DSH_PLUGIN_HOST_ROOT },
  () => {
    const root = mkdtempSync(join(tmpdir(), "skilled-dsh-host-"));
    try {
      cpSync("dist/bundled-plugins/dsh-skilled", join(root, "plugin"), {
        recursive: true,
      });
      symlinkSync(
        join(process.env.SKILLED_DSH_PLUGIN_HOST_ROOT!, "node_modules"),
        join(root, "node_modules"),
        "dir",
      );
      const result = spawnSync(
        process.execPath,
        [
          resolve("dist/tests/plugins/dsh-host-driver.js"),
          root,
          process.env.SKILLED_DSH_PLUGIN_HOST_ROOT!,
          resolve("dist/src/bootstrap.js"),
        ],
        {
          cwd: root,
          env: { PATH: process.env.PATH, DSH_HOME: join(root, "dsh-home") },
          encoding: "utf8",
          timeout: 90_000,
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /"passed":true/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
