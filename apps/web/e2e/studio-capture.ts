import { expect, type Page, type TestInfo } from "@playwright/test";
import { mkdir } from "node:fs/promises";

export async function captureStudioStage(
  page: Page,
  stage: string,
  info: TestInfo,
) {
  await mkdir("/tmp/skilled-studio-screenshots", { recursive: true });
  const original = page.viewportSize()!;
  for (const width of info.project.name === "desktop"
    ? [360, 390, 768, 1280, 1440, 1920]
    : [original.width]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator("main")).toBeVisible();
    const overflow = await page.evaluate(() => ({
      width: window.innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(overflow.document, `${stage} at ${width}px`).toBeLessThanOrEqual(
      overflow.width + 1,
    );
    await page.screenshot({
      path: `/tmp/skilled-studio-screenshots/${info.project.name}-${stage}-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize(original);
}
