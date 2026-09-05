import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { acceptsExecutionEvidence } from "@skilled/core";
export async function realExecutionReady() {
  try {
    const path = process.env.SKILLED_EXECUTION_EVIDENCE;
    const revision =
      process.env.SKILLED_IMAGE_REVISION ?? process.env.RENDER_GIT_COMMIT;
    if (!path || !revision) return false;
    const accepted = acceptsExecutionEvidence(
      JSON.parse(await readFile(path, "utf8")),
      revision,
    );
    if (!accepted) return false;
    const login = await promisify(execFile)(
      process.env.CODEX_BIN ?? "codex",
      ["login", "status"],
      { timeout: 5000, maxBuffer: 4096 },
    );
    return /logged in/i.test(`${login.stdout} ${login.stderr}`);
  } catch {
    return false;
  }
}
export async function requireExecutionReady() {
  if (!(await realExecutionReady()))
    throw new Error(
      "Execution unavailable: the required isolation and login acceptance checks have not passed for this image",
    );
}
