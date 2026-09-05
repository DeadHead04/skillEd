import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const runId = process.env.SCREENSHOT_RUN_ID ?? "current";
const skillId = process.env.SCREENSHOT_SKILL_ID;
const scope = skillId ? `?skill=${skillId}` : "";
const routes = [
  ["skill", `/skill${scope}`],
  ["evals", `/evals/current${scope}`],
  ["run", `/runs/${runId}${scope}`],
  ["improve", `/improve/current${scope}`],
  ["users", "/users"],
] as const;

test("capture login", async ({ page }, testInfo) => {
  await mkdir("/tmp/skilled-pilot-screenshots", { recursive: true });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /Sign in/ })).toBeVisible();
  await page.screenshot({
    path: `/tmp/skilled-pilot-screenshots/${testInfo.project.name}-login.png`,
    fullPage: true,
  });
});

for (const [name, route] of routes) {
  test(`capture ${name}`, async ({ page }, testInfo) => {
    await mkdir("/tmp/skilled-pilot-screenshots", { recursive: true });
    await signIn(page);
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("The workbench could not load")).toHaveCount(0);
    await expect(page.locator("h1").first()).toBeVisible();
    const overflow = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
      escaped: Array.from(
        document.querySelectorAll("input, textarea, select, .panel"),
      )
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < -1 || rect.right > window.innerWidth + 1;
        })
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
        })),
    }));
    expect(overflow.page, JSON.stringify(overflow)).toBeLessThanOrEqual(
      overflow.viewport,
    );
    expect(overflow.escaped, JSON.stringify(overflow)).toEqual([]);
    await page.screenshot({
      path: `/tmp/skilled-pilot-screenshots/${testInfo.project.name}-${name}.png`,
      fullPage: true,
    });
  });
}
