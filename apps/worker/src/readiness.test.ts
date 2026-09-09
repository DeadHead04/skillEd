import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REQUIRED_EXECUTION_CHECKS,
  assessExecutionEvidence,
  acceptsExecutionEvidence,
} from "@skilled/core";
import { executionReadiness } from "./readiness.js";

const report = () => ({
  schemaVersion: "skilled-readiness-v1",
  status: "ready",
  checkedAt: new Date().toISOString(),
  imageRevision: "synthetic-release",
  checks: REQUIRED_EXECUTION_CHECKS.map((name) => ({
    name,
    status: "passed",
    detail: "synthetic test only; sensitive marker must not be returned",
  })),
});

test("acceptance diagnostics reject incomplete, stale, mismatched and malformed evidence without exposing report details", () => {
  const valid = report();
  assert.equal(acceptsExecutionEvidence(valid, valid.imageRevision), true);
  const scenarios: [unknown, string][] = [
    [{}, "ACCEPTANCE_INVALID"],
    [{ ...valid, imageRevision: "old" }, "ACCEPTANCE_REVISION_MISMATCH"],
    [
      { ...valid, checkedAt: new Date(Date.now() - 86400_000).toISOString() },
      "ACCEPTANCE_EXPIRED",
    ],
    [
      { ...valid, checkedAt: new Date(Date.now() + 60_000).toISOString() },
      "ACCEPTANCE_TIME_INVALID",
    ],
    [
      { ...valid, checkedAt: "private-invalid-date" },
      "ACCEPTANCE_TIME_INVALID",
    ],
    [{ ...valid, status: "blocked" }, "ISOLATION_NOT_ACCEPTED"],
    [{ ...valid, checks: [] }, "ISOLATION_NOT_ACCEPTED"],
    [
      { ...valid, checks: [...valid.checks, valid.checks[0]] },
      "ISOLATION_NOT_ACCEPTED",
    ],
    [
      {
        ...valid,
        checks: valid.checks.map((check) => ({ ...check, status: "pending" })),
      },
      "ISOLATION_NOT_ACCEPTED",
    ],
    [
      {
        ...valid,
        checks: valid.checks.map((check) => ({ ...check, status: "failed" })),
      },
      "ISOLATION_NOT_ACCEPTED",
    ],
  ];
  for (const [input, code] of scenarios) {
    const result = assessExecutionEvidence(input, valid.imageRevision);
    assert.equal(result.ready, false);
    assert.equal(result.code, code);
    assert.doesNotMatch(
      JSON.stringify(result),
      /sensitive marker|private-invalid-date/,
    );
  }
  const missing = assessExecutionEvidence(
    { ...valid, checks: [] },
    valid.imageRevision,
  );
  assert.ok("checks" in missing);
  assert.equal(missing.checks.length, REQUIRED_EXECUTION_CHECKS.length);
  assert.ok(missing.checks.every((check) => check.status === "missing"));
});

test("readiness distinguishes missing configuration, unreadable report and login failure; no login probe before isolation passes", async () => {
  const root = await mkdtemp(join(tmpdir(), "skilled-readiness-test-"));
  let calls = 0;
  const login = async () => {
    calls++;
    return true;
  };
  const path = join(root, "acceptance.json");
  const env = {
    SKILLED_EXECUTION_EVIDENCE: path,
    SKILLED_IMAGE_REVISION: "synthetic-release",
  };
  try {
    assert.equal(
      (await executionReadiness({}, login)).code,
      "ACCEPTANCE_MISSING",
    );
    assert.equal(
      (await executionReadiness({ SKILLED_EXECUTION_EVIDENCE: path }, login))
        .code,
      "IMAGE_REVISION_MISSING",
    );
    assert.equal(
      (await executionReadiness(env, login)).code,
      "ACCEPTANCE_UNREADABLE",
    );
    await writeFile(path, "{");
    assert.equal(
      (await executionReadiness(env, login)).code,
      "ACCEPTANCE_UNREADABLE",
    );
    await writeFile(path, JSON.stringify({ ...report(), checks: [] }));
    assert.equal(
      (await executionReadiness(env, login)).code,
      "ISOLATION_NOT_ACCEPTED",
    );
    assert.equal(calls, 0);
    await writeFile(path, JSON.stringify(report()));
    const noLogin = await executionReadiness(env, async () => {
      throw new Error("sensitive authentication text");
    });
    assert.equal(noLogin.code, "AUTHENTICATION_UNAVAILABLE");
    assert.equal(noLogin.codexLogin, "unavailable");
    assert.doesNotMatch(JSON.stringify(noLogin), /sensitive/);
    const ready = await executionReadiness(env, login);
    assert.equal(ready.ready, true);
    assert.equal(ready.code, "READY");
    assert.equal(calls, 1);
    assert.equal(
      (
        await executionReadiness(
          {
            SKILLED_EXECUTION_EVIDENCE: path,
            RENDER_GIT_COMMIT: env.SKILLED_IMAGE_REVISION,
          },
          login,
        )
      ).ready,
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
