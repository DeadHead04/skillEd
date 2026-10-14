import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  DockerRuntime,
  runProcess,
  RuntimeExecutionError,
} from "../../src/runtime/index.js";
import { quotePOSIX } from "../../src/platform/index.js";
const enabled = process.env.SKILLED_DOCKER_INTEGRATION === "1";
const image = process.env.SKILLED_DOCKER_INTEGRATION_IMAGE || "alpine:3.20";
test(
  "real Docker private files use narrow permissions and are erased before retaining a container",
  { skip: !enabled && "set SKILLED_DOCKER_INTEGRATION=1", timeout: 120000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skilled-private-stage-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const source = path.join(root, "auth.json");
    await fs.writeFile(source, '{"test":"private runtime transport fixture"}', { mode: 0o600 });
    const rt = new DockerRuntime({ type: "docker", image, delete: false });
    await rt.create();
    const id = rt.containerID();
    t.after(async () => { await runProcess("docker", ["rm", "-f", id]); });
    await fs.symlink(source, path.join(root, "link"));
    await assert.rejects(rt.stagePrivateFile(path.join(root, "link")), /regular file/);
    await assert.rejects(rt.stagePrivateFile(source, "../escape"), /simple filename/);
    const staged = await rt.stagePrivateFile(source);
    assert.equal((await rt.exec(`stat -c %a ${quotePOSIX(staged.directory)}`)).stdout.trim(), "700");
    assert.equal((await rt.exec(`stat -c %a ${quotePOSIX(staged.path)}`)).stdout.trim(), "600");
    assert.equal((await rt.exec(`cat ${quotePOSIX(staged.path)}`)).stdout, await fs.readFile(source, "utf8"));
    assert.ok(!staged.directory.startsWith(rt.workspace() + "/"));
    await rt.stop();
    await rt.start();
    assert.notEqual((await rt.exec(`cat ${quotePOSIX(staged.path)}`)).exitCode, 0);
    const final = await rt.stagePrivateFile(source);
    await rt.close();
    assert.equal((await runProcess("docker", ["start", id])).exitCode, 0);
    assert.notEqual((await runProcess("docker", ["exec", id, "cat", final.path])).exitCode, 0);
    assert.equal(await fs.readFile(source, "utf8"), '{"test":"private runtime transport fixture"}');
  },
);
test(
  "real Docker judge snapshots exclude SUT root mutations, processes, and unsafe links",
  { skip: !enabled && "set SKILLED_DOCKER_INTEGRATION=1", timeout: 120000 },
  async (t) => {
    const rt = new DockerRuntime({ type: "docker", image, delete: true,
      setupSteps: [{ run: "test ! -e artifact.txt; printf trusted > /root/prepared-before-upload" }],
    });
    t.after(() => rt.close());
    await rt.create();
    await rt.exec("printf fixture > artifact.txt; printf malicious > /root/agent-persistence; (while :; do if test -e /tmp/grading-answer; then cp /tmp/grading-answer /workspace/stolen; fi; sleep 0.1; done) >/dev/null 2>&1 </dev/null &");
    await rt.stop();
    const snapshot = await rt.captureJudgeSnapshot();
    t.after(() => snapshot.close());
    const [first, second] = await Promise.all([snapshot.fork(), snapshot.fork()]);
    t.after(async () => { await Promise.allSettled([first.cleanup(), second.cleanup()]); });
    assert.equal((await first.runtime.exec("cat artifact.txt")).stdout, "fixture");
    assert.equal((await first.runtime.exec("cat /root/prepared-before-upload")).stdout, "trusted");
    assert.notEqual((await first.runtime.exec("cat /root/agent-persistence")).exitCode, 0);
    await first.runtime.exec("printf private > /tmp/grading-answer; printf changed > artifact.txt; sleep 0.3");
    assert.notEqual((await first.runtime.exec("cat stolen")).exitCode, 0);
    assert.equal((await second.runtime.exec("cat artifact.txt")).stdout, "fixture");
    assert.notEqual((await second.runtime.exec("cat /tmp/grading-answer")).exitCode, 0);
    await snapshot.close();
    await assert.rejects(snapshot.fork(), /snapshot is closed/);
    await rt.start();
    await rt.exec("ln -s /etc/passwd outside-link");
    await assert.rejects(rt.captureJudgeSnapshot(), /symlink outside workspace/);
  },
);
test(
  "real Docker concurrent and retained cases cannot read host policy, reports, or another case",
  { skip: !enabled && "set SKILLED_DOCKER_INTEGRATION=1", timeout: 120000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skilled-read-isolation-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const hostOracle = path.join(root, "oracle.txt");
    await fs.writeFile(hostOracle, "PRIVATE-ANSWER-49631");
    const withSkill = new DockerRuntime({ type: "docker", image, delete: true, networkPolicy: "deny_all" });
    const withoutSkill = new DockerRuntime({ type: "docker", image, delete: true, networkPolicy: "deny_all" });
    const retained = new DockerRuntime({ type: "docker", image, delete: false, networkPolicy: "deny_all" });
    t.after(async () => { await Promise.allSettled([withSkill.close(), withoutSkill.close()]); });
    await Promise.all([withSkill.create(), withoutSkill.create(), retained.create()]);
    const retainedID = retained.containerID();
    t.after(async () => { await runProcess("docker", ["rm", "-f", retainedID]); });
    const skillPath = "/workspace/.agents/skills/refund-policy/SKILL.md";
    await Promise.all([withSkill.uploadFile(hostOracle, skillPath), retained.uploadFile(hostOracle, skillPath)]);
    await retained.close();
    // The target exists in the treatment container throughout the attack, and
    // also in a stopped retained container. Separate cwd paths would not pass.
    assert.equal((await withSkill.exec(`cat ${quotePOSIX(skillPath)}`)).stdout, "PRIVATE-ANSWER-49631");
    for (const forbidden of [hostOracle, skillPath, "/var/run/docker.sock", "/proc/1/root" + hostOracle]) {
      const attempt = await withoutSkill.exec(`cat ${quotePOSIX(forbidden)}`);
      assert.notEqual(attempt.exitCode, 0, `read escaped isolation: ${forbidden}`);
      assert.doesNotMatch(attempt.stdout, /PRIVATE-ANSWER/);
    }
    const search = await withoutSkill.exec("find /workspace /tmp /root -type f -name SKILL.md -print 2>/dev/null");
    assert.equal(search.stdout, "");
    for (const rt of [withSkill, withoutSkill]) {
      const inspection = await runProcess("docker", ["inspect", rt.containerID()]);
      const data = JSON.parse(inspection.stdout)[0];
      assert.deepEqual(data.Mounts, []);
      assert.equal(data.HostConfig.Privileged, false);
      assert.notEqual(data.HostConfig.PidMode, "host");
      assert.notEqual(data.HostConfig.NetworkMode, "host");
    }
  },
);
test("Docker rejects unsupported config without connecting", () => {
  assert.throws(() => new DockerRuntime({ type: "docker" }), /image/);
  assert.throws(
    () =>
      new DockerRuntime({
        type: "docker",
        image,
        networkPolicy: "allow_declared",
      }),
    /not supported/,
  );
  assert.throws(
    () =>
      new DockerRuntime({ type: "docker", image, workspaceMount: "relative" }),
    /absolute/,
  );
});
test(
  "real Docker lifecycle, transfers, shell, environment, errors and cleanup",
  { skip: !enabled && "set SKILLED_DOCKER_INTEGRATION=1", timeout: 120000 },
  async (t) => {
    const rt = new DockerRuntime({
      type: "docker",
      image,
      delete: true,
      env: { BASE: "base" },
    });
    t.after(() => rt.close());
    await rt.stop();
    await rt.create();
    const id = rt.containerID();
    assert.ok(id);
    assert.equal((await rt.exec("command -v bash")).exitCode, 127);
    rt.mergeEnv({ BASE: "merged" });
    assert.equal(
      (
        await rt.exec('printf %s "$BASE:$LITERAL"', {
          env: { LITERAL: "$HOME" },
        })
      ).stdout,
      "merged:$HOME",
    );
    const source = await fs.mkdtemp(
      path.join(os.tmpdir(), "skilled-docker-test-"),
    );
    t.after(() => fs.rm(source, { recursive: true, force: true }));
    await fs.mkdir(path.join(source, "in"));
    await fs.writeFile(
      path.join(source, "in", "helper"),
      "#!/bin/sh\nprintf hello",
      { mode: 0o751 },
    );
    await rt.uploadDir(path.join(source, "in"), "input");
    assert.equal((await rt.exec("./input/helper")).stdout, "hello");
    await rt.uploadFile(
      path.join(source, "in", "helper"),
      "/tmp/absolute-helper",
    );
    assert.equal((await rt.exec("/tmp/absolute-helper")).stdout, "hello");
    await rt.downloadDir("input", path.join(source, "out"));
    assert.equal(
      await fs.readFile(path.join(source, "out", "helper"), "utf8"),
      "#!/bin/sh\nprintf hello",
    );
    await rt.downloadFile(
      "/tmp/absolute-helper",
      path.join(source, "download"),
    );
    assert.equal((await rt.exec("printf err >&2; exit 42")).exitCode, 42);
    await assert.rejects(
      rt.exec("pwd", { cwd: "../../" }),
      /escapes workspace/,
    );
    await rt.stop();
    await assert.rejects(rt.exec("true"), RuntimeExecutionError);
    await rt.start();
    assert.equal(
      (await rt.exec("pwd", { cwd: "input" })).stdout,
      "/workspace/input\n",
    );
    await rt.close();
    await rt.stop();
    assert.notEqual((await runProcess("docker", ["inspect", id])).exitCode, 0);
  },
);
test(
  "real Docker network deny policy and custom entrypoint",
  { skip: !enabled && "set SKILLED_DOCKER_INTEGRATION=1", timeout: 60000 },
  async (t) => {
    const rt = new DockerRuntime({
      type: "docker",
      image,
      delete: true,
      networkPolicy: "deny_all",
      entrypoint: [
        "sh",
        "-c",
        "printf started > /entry-marker; sleep infinity",
      ],
    });
    t.after(() => rt.close());
    await rt.create();
    assert.equal((await rt.exec("cat /entry-marker")).stdout, "started");
    const inspection = await runProcess("docker", [
      "inspect",
      "--format",
      "{{.HostConfig.NetworkMode}}",
      rt.containerID(),
    ]);
    assert.equal(inspection.stdout.trim(), "none");
    assert.notEqual(
      (await rt.exec("wget -T 2 -qO- http://1.1.1.1", { timeoutMs: 5000 }))
        .exitCode,
      0,
    );
  },
);
test(
  "real Docker preserve path stops rather than removes container",
  { skip: !enabled && "set SKILLED_DOCKER_INTEGRATION=1", timeout: 60000 },
  async (t) => {
    const rt = new DockerRuntime({ type: "docker", image, delete: false });
    await rt.create();
    const id = rt.containerID();
    t.after(async () => {
      await runProcess("docker", ["rm", "-f", id]);
    });
    await rt.close();
    const state = await runProcess("docker", [
      "inspect",
      "--format",
      "{{.State.Running}}",
      id,
    ]);
    assert.equal(state.exitCode, 0);
    assert.equal(state.stdout.trim(), "false");
  },
);
