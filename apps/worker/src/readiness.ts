import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { assessExecutionEvidence } from "@skilled/core";
export type ExecutionReadiness = {
  ready: boolean;
  code: string;
  detail: string;
  checks?: { name: string; status: string }[];
  checkedAt?: string;
  expiresAt?: string | null;
  codexLogin?: "available" | "unavailable" | "not_checked";
};
export async function executionReadiness(
  env: NodeJS.ProcessEnv = process.env,
  loginStatus = async (binary: string) => {
    const login = await promisify(execFile)(binary, ["login", "status"], {
      timeout: 5000,
      maxBuffer: 4096,
    });
    return /^\s*Logged in\b/im.test(`${login.stdout}\n${login.stderr}`);
  },
): Promise<ExecutionReadiness> {
  const path = env.SKILLED_EXECUTION_EVIDENCE?.trim();
  const revision =
    env.SKILLED_IMAGE_REVISION?.trim() || env.RENDER_GIT_COMMIT?.trim();
  if (!path)
    return {
      ready: false,
      code: "ACCEPTANCE_MISSING",
      codexLogin: "not_checked",
      detail:
        "Execution unavailable: SKILLED_EXECUTION_EVIDENCE is not configured in the execution service. Mount the measured acceptance report and set its container path. The preliminary canary alone cannot certify real execution.",
    };
  if (!revision)
    return {
      ready: false,
      code: "IMAGE_REVISION_MISSING",
      codexLogin: "not_checked",
      detail:
        "Execution unavailable: the executor image revision is missing. Set SKILLED_IMAGE_REVISION to the built release revision, or use Render's RENDER_GIT_COMMIT, then run acceptance for that exact image.",
    };
  let acceptance: ReturnType<typeof assessExecutionEvidence>;
  try {
    const file = await stat(path);
    if (!file.isFile() || file.size > 1024 * 1024)
      throw new Error("Invalid report file");
    const report = JSON.parse(await readFile(path, "utf8"));
    acceptance = assessExecutionEvidence(report, revision);
    if (!acceptance.ready) return { ...acceptance, codexLogin: "not_checked" };
  } catch {
    return {
      ready: false,
      code: "ACCEPTANCE_UNREADABLE",
      codexLogin: "not_checked",
      detail:
        "Execution unavailable: the executor acceptance report cannot be read or validated. Restore a valid report for this image.",
    };
  }
  try {
    if (await loginStatus(env.CODEX_BIN ?? "codex"))
      return {
        ...acceptance,
        ready: true,
        code: "READY",
        codexLogin: "available",
        detail: "Isolation accepted and Codex login available.",
      };
  } catch {
    /* Return a sanitized remedy; never expose command output or credential locations. */
  }
  return {
    ...acceptance,
    ready: false,
    code: "AUTHENTICATION_UNAVAILABLE",
    codexLogin: "unavailable",
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
