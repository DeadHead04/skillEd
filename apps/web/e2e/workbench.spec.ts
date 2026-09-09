import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createZip } from "../../../packages/core/src/archive";

test("package intake has one clear primary action", async ({ page }) => {
  await signIn(page);
  await page.goto("/skill");
  await expect(
    page.getByRole("heading", {
      name: /Add a Skill package|Package contents/i,
    }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
});
test("navigation remains usable without future-product clutter", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/skill");
  await expect(page.getByRole("link", { name: /Package$/ })).toBeVisible();
  await expect(page.getByText("Billing")).toHaveCount(0);
  await expect(page.getByText("Marketplace")).toHaveCount(0);
});

test("protected workbench requires a named user session", async ({ page }) => {
  const api = await page.request.get("/api/v1/skills");
  expect(api.status()).toBe(401);
  await expect(api.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
  await page.goto("/skill");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Login ID").fill(`missing-user-${Date.now()}`);
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".error-box[role=alert]")).toContainText(
    "incorrect",
  );
});

test("sidebar shows uploaded packages without depending on another test's activation", async ({
  page,
}, info) => {
  await signIn(page);
  const dir = await mkdtemp(join(tmpdir(), "skilled-sidebar-"));
  const created: { id: string; name: string }[] = [];
  try {
    for (let index = 0; index < 2; index++) {
      const name = `sidebar-${info.project.name}-${Date.now()}-${index}`;
      await writeFile(
        join(dir, "SKILL.md"),
        `---\nname: ${name}\ndescription: A sidebar navigation fixture.\n---\nRead the task and return evidence.\n`,
      );
      const zip = join(dir, "fixture.zip");
      await createZip(dir, ["SKILL.md"], zip);
      const response = await page.request.post("/api/v1/skill/upload", {
        multipart: {
          skill: {
            name: "fixture.zip",
            mimeType: "application/zip",
            buffer: await readFile(zip),
          },
          taskDescription: "Check sidebar navigation.",
        },
      });
      expect(response.status()).toBe(201);
      created.push({ id: (await response.json()).skillId, name });
    }
    await page.goto("/skill");
    await expect(
      page.getByRole("link", { name: /Add Skill package/ }),
    ).toBeVisible();
    for (const skill of created) {
      const link = page
        .getByRole("navigation", { name: "Skill packages" })
        .locator(`a[href="/skill?skill=${skill.id}"]`);
      await page.locator(".skill-picker summary").click();
      await expect(link).toContainText(skill.name);
      await link.click();
      await expect(page.locator(".studio-topbar")).toContainText(skill.name);
      await page.getByRole("link", { name: /Test plan$/ }).click();
      await expect(page.locator(".studio-topbar")).toContainText(skill.name);
      expect(new URL(page.url()).searchParams.get("skill")).toBe(skill.id);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
