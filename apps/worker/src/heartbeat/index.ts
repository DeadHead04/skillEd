import { serviceEndpoint, type Db } from "@skilled/core";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { executionReadiness } from "../readiness.js";
import { recordHeartbeat } from "./queries.js";

const run = promisify(execFile);

async function version(command: string, args: string[]) {
  try {
    const value = await run(command, args, { timeout: 10_000 });
    return (
      (value.stdout.trim() || value.stderr.trim()).split("\n")[0] ??
      "unavailable"
    );
  } catch {
    return "unavailable";
  }
}

/** Collects execution readiness and records the worker heartbeat. */
export async function heartbeat(sql: Db, workerId: string) {
  if (
    serviceEndpoint("EXECUTOR") &&
    process.env.SKILLED_ADAPTER_MODE !== "fake"
  ) {
    let readiness: Record<string, unknown> = {
      execution: "blocked",
      appServer: false,
      detail: "Executor unreachable",
      code: "EXECUTOR_UNREACHABLE",
      codexLogin: "not_checked",
    };
    try {
      const response = await fetch(`${serviceEndpoint("EXECUTOR")}/readiness`, {
        headers: {
          authorization: `Bearer ${process.env.EXECUTOR_SERVICE_TOKEN ?? ""}`,
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("Executor readiness unavailable");
      const health = await response.json();
      if (
        typeof health.ready !== "boolean" ||
        typeof health.code !== "string" ||
        typeof health.detail !== "string"
      )
        throw new Error("Invalid executor readiness response");
      readiness = {
        ...health,
        execution: health.ready ? "ready" : "blocked",
        appServer: health.ready,
        skillUp: health.ready,
      };
    } catch {
      /* Queue and historical results remain available. */
    }
    await recordHeartbeat(
      sql,
      workerId,
      { node: process.version, executor: "private-service" },
      readiness,
    );
    return;
  }

  const versions = {
    codex: await version(process.env.CODEX_BIN ?? "codex", ["--version"]),
    skillUp: await version(process.env.SKILL_UP_BIN ?? "skill-up", [
      "--version",
    ]),
    skillUpSource: "vendored",
    node: process.version,
  };
  const acceptance =
    process.env.SKILLED_ADAPTER_MODE === "fake"
      ? {
          ready: true,
          code: "DEMO",
          codexLogin: "fake-ready",
          detail: "Demo evidence: deterministic execution without model calls.",
        }
      : await executionReadiness();
  await recordHeartbeat(sql, workerId, versions, {
    ...acceptance,
    appServer: acceptance.ready,
    execution:
      process.env.SKILLED_ADAPTER_MODE === "fake"
        ? "demo"
        : acceptance.ready
          ? "ready"
          : "blocked",
    skillUp: versions.skillUp !== "unavailable",
  });
}
