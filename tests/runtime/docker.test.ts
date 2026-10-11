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
const enabled = process.env.SKILLED_DOCKER_INTEGRATION === "1";
const image = process.env.SKILLED_DOCKER_INTEGRATION_IMAGE || "alpine:3.20";
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
