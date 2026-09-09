import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createZip } from "../../../packages/core/src/archive";
import { signIn } from "./helpers";
import { captureStudioStage } from "./studio-capture";
import { inspectInteractiveEvidence } from "./evidence-interactions";

test("empty-installation upload through candidate verification and explicit activation", async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const dir = await mkdtemp(join(tmpdir(), "skilled-browser-fixture-"));
  const name = `pilot-${info.project.name}-${Date.now()}`;
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Inspect a supplied task fixture and preserve protected fields.\n---\nRead the task input and report evidence.\n`,
  );
  await writeFile(
    join(dir, "input.json"),
    JSON.stringify({ target: "old", protected: 42 }),
  );
  await writeFile(
    join(dir, "expected.json"),
    JSON.stringify({ target: "new", protected: 42 }),
  );
  const zip = join(dir, "fixture.zip");
  await createZip(dir, ["SKILL.md"], zip);
  try {
    await signIn(page);
    await page.goto("/skill?new=1");
    await page.getByLabel("Skill ZIP").setInputFiles(zip);
    await page
      .getByLabel("What should this Skill reliably accomplish?")
      .fill(
        "Inspect a supplied JSON dataset, improve the target field, and preserve every protected field.",
      );
    await page
      .getByLabel(
        "Task materials (dataset, authority, examples, or expected outputs)",
      )
      .setInputFiles([join(dir, "input.json"), join(dir, "expected.json")]);
    await page.getByLabel("expected.json provides").selectOption("expected");
    await page.getByRole("button", { name: "Upload and inspect" }).click();
    await page.waitForURL(/\/skill\?skill=/, { timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "Package contents", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Create evals", exact: true })
      .click();
    await page.waitForURL(/\/evals\/[0-9a-f-]+/, { timeout: 15_000 });
    const evalUrl = page.url();
    const evalId = new URL(evalUrl).pathname.split("/").pop()!;
    const skillId = new URL(evalUrl).searchParams.get("skill")!;
    const skill = await (
      await page.request.get(`/api/v1/skill/current?skill=${skillId}`)
    ).json();
    expect(skill.active_version_id).toBeNull();

    await expect(
      page.getByRole("button", { name: /Generate evals/i }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("link", { name: "Request change ↗" }).first().click();
    await page
      .getByLabel("Message Codex")
      .fill("Keep protected fields unchanged and explain missing evidence.");
    await page.getByRole("button", { name: "Send to Codex" }).click();
    await expect(
      page.getByRole("button", { name: "Apply proposed revision" }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.locator(".profile-revision")).toContainText(
      "Keep protected fields unchanged",
    );
    await captureStudioStage(page, "revision", info);
    await page.getByRole("button", { name: "Apply proposed revision" }).click();
    await expect(
      page.getByText("This proposal belongs to an older draft.", {
        exact: false,
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("complementary", { name: "Evidence" }),
    ).toHaveCount(0);
    await captureStudioStage(page, "plan", info);
    await page.getByRole("button", { name: /Generate evals/i }).click();
    await expect(
      page.getByRole("button", { name: /Approve eval/i }),
    ).toBeVisible({ timeout: 30_000 });
    await captureStudioStage(page, "coverage", info);
    await page.getByRole("button", { name: /Approve eval/i }).click();
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`/api/v1/evals/${evalId}`, {
                maxRetries: 2,
              })
            ).json()
          ).status,
      )
      .toBe("approved");
    const forbidden = await page.request.patch(
      `/api/v1/evals/${evalId}/cases/FG-001`,
      { data: { enabled: false } },
    );
    expect(forbidden.status()).toBe(409);
    await page.goto(`/runs/new?skill=${skillId}&eval=${evalId}`);
    await page.getByLabel("Repeated trials").selectOption("2");
    await page.getByLabel("Include a baseline without the Skill").check();
    await captureStudioStage(page, "configure", info);
    await page.getByRole("button", { name: "Launch evaluation" }).click();
    await page.waitForURL(/\/runs\/[0-9a-f-]+/);
    await page.reload();
    await expect(page.getByText("Demo evidence", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("button", { name: "Suggest update" }),
    ).toBeVisible({ timeout: 30_000 });
    await captureStudioStage(page, "results", info);
    await inspectInteractiveEvidence(page);
    await captureStudioStage(page, "interactive-results", info);
    await page.getByRole("button", { name: "Suggest update" }).click();
    await page.waitForURL(/\/improve\/[0-9a-f-]+/);
    await page.reload();
    await expect(
      page.getByRole("button", { name: /Approve Skill only/i }),
    ).toBeVisible({ timeout: 30_000 });
    await captureStudioStage(page, "improve", info);
    await page.getByRole("button", { name: /Approve Skill only/i }).click();
    await expect(
      page.getByRole("button", { name: /Verify candidate/i }),
    ).toBeVisible({ timeout: 30_000 });
    // Verification must recover from server state even when its SSE connection
    // is lost and the user refreshes after dispatch.
    await page.route("**/api/v1/jobs/*/events", (route) => route.abort());
    const verification = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/verify"),
    );
    await page.getByRole("button", { name: /Verify candidate/i }).click();
    expect((await verification).ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole("button", { name: /Activate/i })).toBeVisible({
      timeout: 60_000,
    });
    const before = await (
      await page.request.get(`/api/v1/skill/current?skill=${skillId}`)
    ).json();
    expect(before.active_version_id).toBeNull();
    await page.getByRole("button", { name: /Activate/i }).click();
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`/api/v1/skill/current?skill=${skillId}`)
            ).json()
          ).active_version_id,
      )
      .not.toBeNull();
    await page.goto(`/runs/new?skill=${skillId}&eval=${evalId}`);
    await expect(
      page.locator(".assessment-strip strong").first(),
    ).toContainText("v1");
    await page.goto(`/release?skill=${skillId}`);
    await captureStudioStage(page, "release", info);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
