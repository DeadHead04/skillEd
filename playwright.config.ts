import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/e2e",
  globalSetup: "./apps/web/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  preserveOutput: "always",
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", grep: /@responsive/, use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command:
      "node apps/web/node_modules/next/dist/bin/next dev apps/web --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      DEV_AUTH_BYPASS: "true",
      APP_URL: "http://127.0.0.1:3000",
      AUTH_SECRET: "e2e-auth-secret-with-enough-entropy",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://skilled:skilled@127.0.0.1:54329/skilled",
      ARTIFACT_ROOT: "./artifacts/e2e",
      IMPORT_STAGING_ROOT: "./tmp/e2e-imports",
    },
  },
});
