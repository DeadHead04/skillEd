import { serviceEndpoint } from "@skilled/core";
import { executionReadiness } from "./readiness.js";

const demo = process.env.SKILLED_ADAPTER_MODE === "fake";
const endpoint = serviceEndpoint("EXECUTOR");
let readiness;
if (demo) {
  readiness = {
    ready: false,
    code: "DEMO",
    detail:
      "Demo mode produces deterministic evidence. It does not certify real execution.",
  };
} else if (endpoint) {
  try {
    const response = await fetch(`${endpoint}/readiness`, {
      headers: {
        authorization: `Bearer ${process.env.EXECUTOR_SERVICE_TOKEN ?? ""}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Executor unavailable");
    const value = await response.json();
    readiness = {
      ready: value.ready === true,
      code: value.code,
      detail: value.detail,
      checks: value.checks,
      codexLogin: value.codexLogin,
      checkedAt: value.checkedAt,
      expiresAt: value.expiresAt,
    };
  } catch {
    readiness = {
      ready: false,
      code: "EXECUTOR_UNREACHABLE",
      detail:
        "Cannot read authenticated executor readiness. Check its address, token configuration and service version.",
    };
  }
} else readiness = await executionReadiness();
console.log(
  JSON.stringify(
    {
      adapter: demo ? "demo" : "real",
      executionService: endpoint ? "remote" : "local",
      ...(!endpoint && !demo
        ? {
            configuration: {
              evidenceConfigured: Boolean(
                process.env.SKILLED_EXECUTION_EVIDENCE?.trim(),
              ),
              revisionConfigured: Boolean(
                process.env.SKILLED_IMAGE_REVISION?.trim() ||
                  process.env.RENDER_GIT_COMMIT?.trim(),
              ),
            },
          }
        : {}),
      ...readiness,
    },
    null,
    2,
  ),
);
process.exitCode =
  readiness.ready || (demo && process.argv.includes("--demo")) ? 0 : 1;
