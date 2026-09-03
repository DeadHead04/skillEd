import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

test("package intake has one clear primary action", async ({ page }) => {
  await signIn(page);
  await page.goto("/skill");
  await expect(
    page.getByRole("heading", { name: /Bring one Skill|Active package/i }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
});
test("navigation remains usable without future-product clutter", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/skill");
  await expect(
    page.getByRole("link", { name: "Package", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Billing")).toHaveCount(0);
  await expect(page.getByText("Marketplace")).toHaveCount(0);
});

test("protected workbench requires a named user session", async ({ page }) => {
  const api = await page.request.get("/api/v1/skills");
  expect(api.status()).toBe(401);
  await expect(api.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
  await page.goto("/skill");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Login ID").fill("missing-user");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".error-box[role=alert]")).toContainText(
    "incorrect",
  );
});

test("sidebar exposes every Skill package with an honest latest-run count", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/skill");
  await expect(
    page.getByRole("navigation", { name: "Skill packages" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Add Skill package/ }),
  ).toBeVisible();
  await expect(page.getByText(/Active v/).first()).toBeVisible();
  await expect(page.getByLabel(/of 10 cases passing/).first()).toBeVisible();

  await page
    .getByRole("navigation", { name: "Skill packages" })
    .getByRole("link", { name: /jiomart-hindi-pdp-qc/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "jiomart-hindi-pdp-qc" }),
  ).toBeVisible();
  await expect(page.locator(".context")).toContainText("active v3");
  await page.getByRole("link", { name: "Evals", exact: true }).click();
  await expect(page.locator(".context")).toContainText("jiomart-hindi-pdp-qc");
  await expect(page.getByText(/Hindi PDP content/).first()).toBeVisible();

  await page
    .getByRole("navigation", { name: "Skill packages" })
    .getByRole("link", { name: /grounded-product-qc/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "grounded-product-qc" }),
  ).toBeVisible();
  await expect(page.locator(".context")).toContainText("active v2");
  await page.getByRole("link", { name: "Evals", exact: true }).click();
  await expect(page.locator(".context")).toContainText("grounded-product-qc");
  await expect(
    page.getByText(/authoritative source facts/).first(),
  ).toBeVisible();
});
