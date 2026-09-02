import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.PLAYWRIGHT_TEST_BASE_URL;

export default defineConfig({
  testDir: "./apps/web/e2e",
  outputDir: "/tmp/skilled-playwright",
  reporter: [["line"]],
  use: { baseURL: externalBaseUrl ?? "http://127.0.0.1:3000" },
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "pnpm --filter @skilled/web dev",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: true,
      },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
});
