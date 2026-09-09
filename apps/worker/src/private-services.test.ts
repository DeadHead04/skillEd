import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { signArtifactGrant } from "@skilled/core";
async function port() {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const p = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}
async function ready(url: string, child: ChildProcess) {
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) throw new Error("Service failed at startup");
    try {
      if ((await fetch(url + "/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Service failed to start");
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
}

test(
  "private services require scoped authentication and executor fails closed",
  { skip: process.env.SKILLED_PRIVATE_SERVICE_TESTS !== "true" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "skilled-service-test-"));
    const pair = generateKeyPairSync("ed25519");
    const privateKey = pair.privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString();
    const publicKey = pair.publicKey
      .export({ format: "pem", type: "spki" })
      .toString();
    const storagePort = await port(),
      executorPort = await port();
    const storageUrl = `http://127.0.0.1:${storagePort}`,
      executorUrl = `http://127.0.0.1:${executorPort}`;
    const env = { PATH: process.env.PATH, HOME: root };
    const artifact = spawn(
      process.execPath,
      ["--import", "tsx", "apps/worker/src/artifact-service.ts"],
      {
        env: {
          ...env,
          PORT: String(storagePort),
          ARTIFACT_ROOT: join(root, "artifacts"),
          ARTIFACT_VERIFY_KEY: publicKey,
        },
        stdio: "pipe",
      },
    );
    let executor: ChildProcess | undefined;
    try {
      await ready(storageUrl, artifact);
      const key = "exact/output.json",
        path = storageUrl + "/objects/" + encodeURIComponent(key);
      assert.equal((await fetch(path)).status, 403);
      const write = signArtifactGrant(
        { key, operation: "write", maxBytes: 20 },
        privateKey,
      );
      assert.equal(
        (
          await fetch(path, {
            method: "PUT",
            headers: { authorization: "Bearer " + write },
            body: "immutable",
          })
        ).status,
        200,
      );
      const read = signArtifactGrant(
        { key, operation: "read", maxBytes: 20 },
        privateKey,
      );
      assert.equal(
        await (
          await fetch(path, { headers: { authorization: "Bearer " + read } })
        ).text(),
        "immutable",
      );
      assert.equal(
        (
          await fetch(path, {
            method: "PUT",
            headers: { authorization: "Bearer " + read },
            body: "wrong operation",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(path + "-other", {
            headers: { authorization: "Bearer " + read },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(path, {
            method: "PUT",
            headers: { authorization: "Bearer " + write },
            body: "changed",
          })
        ).status,
        403,
      );
      executor = spawn(
        process.execPath,
        ["--import", "tsx", "apps/worker/src/executor-service.ts"],
        {
          env: {
            ...env,
            PORT: String(executorPort),
            EXECUTOR_STATE_ROOT: join(root, "executor"),
            EXECUTOR_SERVICE_TOKEN: "synthetic-private-service-token",
            ARTIFACT_SERVICE_URL: storageUrl,
          },
          stdio: "pipe",
        },
      );
      await ready(executorUrl, executor);
      assert.equal((await fetch(executorUrl + "/readiness")).status, 401);
      const readiness = await fetch(executorUrl + "/readiness", {
        headers: { authorization: "Bearer synthetic-private-service-token" },
      });
      assert.equal(readiness.status, 200);
      const diagnostic = await readiness.json();
      assert.equal(diagnostic.code, "ACCEPTANCE_MISSING");
      assert.equal(diagnostic.ready, false);
      assert.equal(diagnostic.codexLogin, "not_checked");
      assert.equal(
        (await (await fetch(executorUrl + "/health")).json()).execution,
        "blocked",
      );
      assert.equal(
        (await fetch(executorUrl + "/executions", { method: "POST" })).status,
        401,
      );
      const denied = await fetch(executorUrl + "/executions", {
        method: "POST",
        headers: {
          authorization: "Bearer synthetic-private-service-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          executionId: crypto.randomUUID(),
          jobId: crypto.randomUUID(),
          resourceId: crypto.randomUUID(),
          leaseToken: 1,
          adapter: "real",
          inputKey: key,
          inputChecksum: "0".repeat(64),
          inputGrant: read,
          operation: {
            kind: "skillup",
            evalPath: "evals/eval.yaml",
            model: "fixture",
            iterations: 1,
            baseline: false,
            selectedCaseIds: ["CASE"],
          },
        }),
      });
      assert.equal(denied.status, 400);
      assert.match((await denied.json()).error, /Execution unavailable/);
    } finally {
      if (executor) await stop(executor);
      await stop(artifact);
      await rm(root, { recursive: true, force: true });
    }
  },
);
