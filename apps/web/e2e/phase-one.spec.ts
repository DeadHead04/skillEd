import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Page,
  type Route,
  type TestInfo,
} from "@playwright/test";

const state = JSON.parse(
  fs.readFileSync(path.resolve("./.auth/e2e-state.json"), "utf8"),
) as {
  workspaceId: string;
  emptyWorkspaceId: string;
};

async function signIn(
  page: Page,
  profile: "populated" | "empty" = "populated",
) {
  await page.goto(
    profile === "empty" ? "/api/dev/login?profile=empty" : "/api/dev/login",
  );
  await page.waitForURL(/\/workspaces\/[^/]+\/skills/);
}

async function assertAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const screenshotPath = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(name, {
    path: screenshotPath,
    contentType: "image/png",
  });
}

function importCandidate(duplicate = false) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    sourcePath: "skills/release-notes-writer",
    name: "release-notes-writer",
    description:
      "Generate clear release notes from structured changes and commits.",
    validationStatus: "valid_with_warnings",
    findings: [
      {
        severity: "information",
        code: "EXECUTABLE_HELPER_DETECTED",
        message:
          "Executable helper detected; Phase 1 never executes package scripts.",
        relativePath: "scripts/",
      },
    ],
    fileCounts: {
      instructions: 1,
      reference: 1,
      script: 1,
      asset: 1,
      eval: 1,
      other: 0,
    },
    ...(duplicate
      ? { duplicateVersionId: "22222222-2222-4222-8222-222222222222" }
      : {}),
  };
}

async function mockImport(page: Page, duplicate = false) {
  let pollCount = 0;
  await page.route("**/connections/github", async (route: Route) => {
    await route.fulfill({
      json: { connected: true, accountLogin: "acme-org" },
    });
  });
  await page.route("**/imports/github", async (route: Route) => {
    await route.fulfill({
      status: 202,
      json: { importId: "import-1", status: "queued" },
    });
  });
  await page.route("**/imports/upload", async (route: Route) => {
    await route.fulfill({
      status: 202,
      json: { importId: "import-1", status: "queued" },
    });
  });
  await page.route("**/imports/import-1/selections", async (route: Route) => {
    await route.fulfill({
      status: 202,
      json: { importId: "import-1", status: "persisting" },
    });
  });
  await page.route("**/imports/import-1", async (route: Route) => {
    pollCount += 1;
    await route.fulfill({
      json:
        pollCount > 1
          ? {
              id: "import-1",
              state: "completed",
              errorCode: null,
              errorMessage: null,
              candidates: [],
            }
          : {
              id: "import-1",
              state: "awaiting_selection",
              errorCode: null,
              errorMessage: null,
              candidates: [importCandidate(duplicate)],
            },
    });
  });
}

test("login, empty catalog, and accessible application shell", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Welcome to SkillEd" }),
  ).toBeVisible();
  await assertAccessible(page);
  await page.goto("/api/dev/login?profile=empty");
  await expect(
    page.getByRole("heading", { name: "Import your first Skill" }),
  ).toBeVisible();
  await expect(page.getByText("Empty User", { exact: true })).toBeVisible();
  await assertAccessible(page);
});

test("catalog search, filters, sorting, page size, and pagination", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "Skill catalog" }),
  ).toBeVisible();
  await expect(page.locator(".skill-card")).toHaveCount(12);
  await attachScreenshot(page, testInfo, "01-skill-catalog");
  await page.getByRole("link", { name: "Next page" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator(".skill-card")).toHaveCount(1);
  await page.goto(`/workspaces/${state.workspaceId}/skills`);

  await page
    .getByPlaceholder("Search skills by name, description, or path")
    .fill("release");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/q=release/);
  await expect(
    page.getByRole("heading", { name: "release-notes-writer" }),
  ).toBeVisible();

  await page.getByLabel("Validation status").selectOption("invalid");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("No Skills match these filters")).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(`/workspaces/${state.workspaceId}/skills`);
  await expect(page.locator(".skill-card")).toHaveCount(12);
  await page.getByLabel("Sort Skills").selectOption("name_desc");
  await page.getByLabel("Skills per page").selectOption("24");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/sort=name_desc/);
  await expect(page.locator(".skill-card")).toHaveCount(13);
  await page.getByLabel("Source type").selectOption("github");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/source=github/);
  await expect(page.locator(".skill-card")).toHaveCount(5);
  await assertAccessible(page);
});

test("GitHub connection-required and import candidate flow", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.route("**/connections/github", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { connected: false, accountLogin: null } });
    } else {
      await route.fulfill({
        status: 500,
        json: {
          error: {
            code: "INTERNAL_ERROR",
            message: "GitHub App is not configured.",
          },
        },
      });
    }
  });
  await page.getByRole("button", { name: "Import Skill" }).click();
  await expect(page.getByText("Install the GitHub App")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Scan repository" }),
  ).toBeDisabled();
  await assertAccessible(page);
  await attachScreenshot(page, testInfo, "02-import-skill");
});

test("GitHub import resolves through progress, selection, duplicate state, and completion", async ({
  page,
}, testInfo) => {
  await mockImport(page, true);
  await signIn(page);
  await page.getByRole("button", { name: "Import Skill" }).click();
  await page
    .getByLabel("Repository URL")
    .fill("https://github.com/acme/skills");
  await page.getByLabel("Optional branch, tag, or commit").fill("release/v1");
  await page.getByRole("button", { name: "Scan repository" }).click();
  await expect(
    page.getByRole("heading", { name: "Review detected Skills" }),
  ).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("Duplicate version detected")).toBeVisible();
  await expect(page.getByText("1 of 1 selected")).toBeVisible();
  await attachScreenshot(page, testInfo, "03-import-validation");
  await page.getByRole("button", { name: "Import selected Skills" }).click();
  await expect(
    page.getByRole("heading", { name: "Skills imported" }),
  ).toBeVisible({ timeout: 5000 });
});

test("ZIP and browser-folder sources can enter the same safe scan flow", async ({
  page,
}) => {
  await mockImport(page);
  await signIn(page);
  await page.getByRole("button", { name: "Import Skill" }).click();
  await page.locator('input[accept*="zip"]').setInputFiles({
    name: "skill.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("mock zip; request is intercepted"),
  });
  await expect(page.getByText("skill.zip")).toBeVisible();
  await page.getByRole("button", { name: "Scan upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Review detected Skills" }),
  ).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "Back" }).click();
  await page
    .locator('input[webkitdirectory=""]')
    .setInputFiles(
      path.resolve(
        "./packages/skill-package/testdata/repository/release-notes-writer",
      ),
    );
  await expect(page.getByText(/files selected/)).toBeVisible();
});

test("skill Overview, safe Files, and future empty tabs", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto(`/workspaces/${state.workspaceId}/skills?q=release`);
  await page.getByRole("heading", { name: "release-notes-writer" }).click();
  await expect(page.getByRole("heading", { name: "Provenance" })).toBeVisible();
  await expect(page.getByText(/sha256:/)).toBeVisible();
  await attachScreenshot(page, testInfo, "04-skill-detail");
  await page.getByRole("link", { name: /^Files/ }).click();
  await page.getByRole("link", { name: "scripts/format.sh" }).click();
  await expect(page.locator(".code-preview")).toContainText("never executes");
  const fileResponse = await page.request.get(
    (await page
      .getByRole("link", { name: "Download file" })
      .getAttribute("href")) ?? "",
  );
  expect(fileResponse.headers()["x-content-type-options"]).toBe("nosniff");
  expect(fileResponse.headers()["content-security-policy"]).toContain(
    "sandbox",
  );

  for (const tab of ["Tests", "Runs", "Statistics"]) {
    await page.getByRole("link", { name: new RegExp(`^${tab}`) }).click();
    await expect(
      page.getByRole("heading", {
        name: `${tab.toLowerCase()[0]!.toUpperCase()}${tab.toLowerCase().slice(1)} are coming later`,
      }),
    ).toBeVisible();
  }
  await assertAccessible(page);
});

test("guessed cross-workspace URLs are denied", async ({ page }) => {
  await signIn(page);
  await page.goto(`/workspaces/${state.emptyWorkspaceId}/skills`);
  await expect(
    page.getByRole("heading", { name: "Workspace content not found" }),
  ).toBeVisible();
});

test("failed import is announced, retryable, and restores keyboard focus", async ({
  page,
}) => {
  await signIn(page);
  await page.route("**/connections/github", async (route) => {
    await route.fulfill({
      json: { connected: true, accountLogin: "acme-org" },
    });
  });
  await page.route("**/imports/github", async (route) => {
    await route.fulfill({
      status: 202,
      json: { importId: "failed-import", status: "queued" },
    });
  });
  await page.route("**/imports/failed-import", async (route) => {
    await route.fulfill({
      json: {
        id: "failed-import",
        state: "failed",
        errorCode: "NO_SKILLS_FOUND",
        errorMessage: "No SKILL.md files were found.",
        candidates: [],
      },
    });
  });
  const trigger = page.getByRole("button", { name: "Import Skill" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Repository URL").fill("https://github.com/acme/empty");
  await page.getByRole("button", { name: "Scan repository" }).click();
  await expect(
    page.getByRole("heading", { name: "Import failed" }),
  ).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByText("No SKILL.md files were found.")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByLabel("Repository URL")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("@responsive catalog and drawer remain usable on mobile", async ({
  page,
}) => {
  await signIn(page);
  await expect(page.locator(".skill-grid")).toHaveCSS(
    "grid-template-columns",
    /.+/,
  );
  await page.getByRole("button", { name: "Import Skill" }).click();
  await expect(page.locator(".dialog-content")).toBeVisible();
  const box = await page.locator(".dialog-content").boundingBox();
  expect(box?.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
