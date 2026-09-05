import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createZip } from "../../../packages/core/src/archive";
import { signIn } from "./helpers";

test("empty-installation upload through candidate verification and explicit activation", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
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
    await page.waitForURL(/\/evals\/[0-9a-f-]+/, { timeout: 15_000 });
    const evalUrl = page.url();
    const evalId = new URL(evalUrl).pathname.split("/").pop()!;
    const skillId = new URL(evalUrl).searchParams.get("skill")!;
    const skill = await (
      await page.request.get(`/api/v1/skill/current?skill=${skillId}`)
    ).json();
    expect(skill.active_version_id).toBeNull();
    await page.getByRole("button", { name: "Start understanding" }).click();
    await expect(
      page.getByRole("button", { name: /Generate evals/i }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /Generate evals/i }).click();
    await expect(
      page.getByRole("button", { name: /Approve eval/i }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /Approve eval/i }).click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/v1/evals/${evalId}`)).json())
            .status,
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
    await page.getByRole("button", { name: "Launch evaluation" }).click();
    await page.waitForURL(/\/runs\/[0-9a-f-]+/);
    await page.reload();
    await expect(page.getByText("Demo evidence", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("button", { name: "Suggest update" }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Suggest update" }).click();
    await page.waitForURL(/\/improve\/[0-9a-f-]+/);
    await page.reload();
    await expect(
      page.getByRole("button", { name: /Approve Skill only/i }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /Approve Skill only/i }).click();
    await expect(
      page.getByRole("button", { name: /Verify candidate/i }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /Verify candidate/i }).click();
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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
