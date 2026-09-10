import { serviceEndpoint } from "@skilled/core";
import { readFile } from "node:fs/promises";

export const PERMISSION_PROFILE = "skilled-workspace-v2";
export async function builtRuntimeRevision() {
  return (
    await readFile("/opt/skilled/image-revision", "utf8").catch(() => "")
  ).trim();
}

export async function executionIdentity() {
  const endpoint = serviceEndpoint("EXECUTOR");
  if (endpoint) {
    const response = await fetch(`${endpoint}/readiness`, {
      headers: {
        authorization: `Bearer ${process.env.EXECUTOR_SERVICE_TOKEN ?? ""}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Executor identity unavailable");
    const identity = await response.json();
    if (
      !identity.ready ||
      typeof identity.imageRevision !== "string" ||
      identity.permissionPolicy !== PERMISSION_PROFILE
    )
      throw new Error("Executor has not reported an accepted runtime identity");
    return {
      imageRevision: identity.imageRevision,
      permissionPolicy: identity.permissionPolicy,
    };
  }
  const imageRevision =
    (await builtRuntimeRevision()) ||
    process.env.SKILLED_IMAGE_REVISION ||
    process.env.RENDER_GIT_COMMIT;
  if (!imageRevision) throw new Error("Execution runtime identity unavailable");
  return { imageRevision, permissionPolicy: PERMISSION_PROFILE };
}
