import type { Page } from "@playwright/test";

export async function signIn(page: Page) {
  await page.goto("/login");
  await page
    .getByLabel("Administrator password")
    .fill(process.env.SKILLED_E2E_PASSWORD ?? "skilled-local");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}
