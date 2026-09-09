import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { acceptsExecutionEvidence } from "@skilled/core";
export type ExecutionReadiness = {
  ready: boolean;
  code: string;
  detail: string;
};
export async function executionReadiness(): Promise<ExecutionReadiness> {
  const path = process.env.SKILLED_EXECUTION_EVIDENCE;
  const revision =
    process.env.SKILLED_IMAGE_REVISION ?? process.env.RENDER_GIT_COMMIT;
  if (!path || !revision)
    return {
      ready: false,
      code: "ACCEPTANCE_MISSING",
      detail:
        "Execution unavailable: no isolation acceptance report is configured for this image. An administrator must run the executor canary and configure the accepted report.",
    };
  try {
    const report = JSON.parse(await readFile(path, "utf8"));
    if (!acceptsExecutionEvidence(report, revision))
      return {
        ready: false,
        code: "ISOLATION_NOT_ACCEPTED",
        detail:
          "Execution unavailable: isolation acceptance is incomplete, expired, or belongs to another image. Run the canary on this exact executor image; inspect failed and pending checks in Diagnostics.",
      };
  } catch {
    return {
      ready: false,
      code: "ACCEPTANCE_UNREADABLE",
      detail:
        "Execution unavailable: the executor acceptance report cannot be read or validated. Restore a valid report for this image.",
    };
  }
  try {
    const login = await promisify(execFile)(
      process.env.CODEX_BIN ?? "codex",
      ["login", "status"],
      { timeout: 5000, maxBuffer: 4096 },
    );
    if (/logged in/i.test(`${login.stdout} ${login.stderr}`))
      return {
        ready: true,
        code: "READY",
        detail: "Isolation accepted and Codex login available.",
      };
  } catch {
    /* Return a sanitized remedy; never expose command output or credential locations. */
  }
  return {
    ready: false,
    code: "AUTHENTICATION_UNAVAILABLE",
    detail:
      "Execution unavailable: Codex login is missing or unavailable. An administrator must complete the official login flow directly on the executor.",
  };
}
export async function realExecutionReady() {
  return (await executionReadiness()).ready;
}
export async function requireExecutionReady() {
  const state = await executionReadiness();
  if (!state.ready) throw new Error(state.detail);
}
