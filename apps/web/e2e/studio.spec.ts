import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

test("dashboard and registry separate actions from package browsing", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Make your Skills work better." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Continue your work" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Primary", exact: true })
    .getByRole("link", { name: "Skills", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Skills", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Search Skills", { exact: true })
    .fill("no-matching-package-0000");
  await expect(
    page.getByRole("heading", { name: /No matching Skills|Your first Skill/ }),
  ).toBeVisible();
  await page.getByLabel("Search Skills", { exact: true }).fill("");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.locator(".registry")).toHaveClass(/list/);
});
test("studio layouts stay within viewport and expose keyboard navigation", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await signIn(page);
  for (const width of info.project.name === "desktop"
    ? [360, 390, 768, 1280, 1440, 1920]
    : [info.project.name === "mobile" ? 390 : 1272]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ["/dashboard", "/skills", "/skill?new=1"]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
    }
  }
  await page.goto("/dashboard");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
});

test("dashboard and registry reflow at 200 percent zoom", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Desktop zoom reflow");
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const path of ["/dashboard", "/skills", "/skill?new=1"]) {
    await page.goto(path);
    await page.evaluate(() => {
      document.body.style.zoom = "2";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("navigation", { name: "Primary", exact: true }),
    ).toBeVisible();
  }
});
