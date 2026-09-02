import { test, expect } from "@playwright/test";

test("package intake has one clear primary action", async ({ page }) => {
  await page.goto("/skill");
  await expect(
    page.getByRole("heading", { name: /Bring one Skill|Active package/i }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
});
test("navigation remains usable without future-product clutter", async ({
  page,
}) => {
  await page.goto("/skill");
  await expect(page.getByRole("link", { name: "Skill" })).toBeVisible();
  await expect(page.getByText("Billing")).toHaveCount(0);
  await expect(page.getByText("Marketplace")).toHaveCount(0);
});
