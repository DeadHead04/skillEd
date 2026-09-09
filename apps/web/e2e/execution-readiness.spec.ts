import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createZip } from "../../../packages/core/src/archive";
import { signIn } from "./helpers";

// Run only against a separate, credential-free real-mode test installation.
// This never creates acceptance evidence or switches an existing worker mode.
test("blocked execution preserves the task and rechecks without queuing generation", async ({
  page,
}) => {
  test.skip(
    process.env.SKILLED_E2E_BLOCKED_EXECUTION !== "true",
    "Requires the isolated real-mode installation with no acceptance report",
  );
  const root = await mkdtemp(join(tmpdir(), "skilled-blocked-e2e-"));
  try {
    await signIn(page);
    const readiness = await (
      await page.request.get("/api/v1/execution-readiness")
    ).json();
    expect(readiness.code).toBe("ACCEPTANCE_MISSING");
    expect(readiness.available).toBe(false);
    await writeFile(
      join(root, "SKILL.md"),
      `---\nname: readiness-${Date.now()}\ndescription: Describe a synthetic task input.\n---\nRead the task input and describe it.\n`,
    );
    const zip = join(root, "fixture.zip");
    await createZip(root, ["SKILL.md"], zip);
    await page.goto("/skill?new=1");
    await page.getByLabel("Skill ZIP").setInputFiles(zip);
    await page
      .getByLabel("What should this Skill reliably accomplish?")
      .fill("Describe the synthetic input.");
    const upload = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/skill/upload") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Upload and inspect" }).click();
    const saved = await (await upload).json();
    await page.goto(`/evals/${saved.evalId}?skill=${saved.skillId}`);
    await expect(
      page.getByRole("button", { name: "Recheck execution" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start understanding", exact: true }),
    ).toHaveCount(0);
    let generationRequests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().includes("/api/v1/evals/")
      )
        generationRequests++;
    });
    for (let n = 0; n < 3; n++) {
      const recheck = page.waitForResponse((response) =>
        response.url().endsWith("/api/v1/execution-readiness"),
      );
      await page.getByRole("button", { name: "Recheck execution" }).click();
      expect((await (await recheck).json()).available).toBe(false);
      await expect(
        page.getByRole("button", { name: "Recheck execution" }),
      ).toBeEnabled();
    }
    expect(generationRequests).toBe(0);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Recheck execution" }),
    ).toBeVisible();
    const blocked = await page.request.post(
      `/api/v1/evals/${saved.evalId}/author`,
      { data: {} },
    );
    expect(blocked.status()).toBe(503);
    const draft = await (
      await page.request.get(`/api/v1/evals/${saved.evalId}`)
    ).json();
    expect(draft.status).toBe("collecting");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.goto("/diagnostics");
    await expect(
      page.getByRole("heading", { name: "Execution setup needs attention" }),
    ).toBeVisible();
    await expect(
      page.getByText("Reason: ACCEPTANCE_MISSING", { exact: false }),
    ).toBeVisible();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
