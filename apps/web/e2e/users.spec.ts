import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("administrators create operators and deactivation revokes their session", async ({
  browser,
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto("/users");
  await expect(
    page.getByRole("heading", {
      name: "Control who can operate the workbench",
    }),
  ).toBeVisible();

  const meResponse = await page.request.get("/api/v1/auth/me");
  expect(meResponse.status()).toBe(200);
  const me = (await meResponse.json()).user;
  const selfLockout = await page.request.patch(`/api/v1/users/${me.id}`, {
    data: { active: false },
  });
  expect(selfLockout.status()).toBe(409);
  expect((await selfLockout.json()).code).toBe("SELF_LOCKOUT");

  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const loginId = `operator-${suffix}`;
  const password = `Temporary-${suffix}-password`;
  await page
    .getByLabel("Display name")
    .fill(`Test Operator ${testInfo.project.name}`);
  await page.getByLabel("Login ID").last().fill(loginId);
  await page.getByLabel("Temporary password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(`@${loginId}`)).toBeVisible();

  const usersResponse = await page.request.get("/api/v1/users");
  expect(usersResponse.status()).toBe(200);
  const created = (await usersResponse.json()).users.find(
    (user: { login_id: string }) => user.login_id === loginId,
  );
  expect(created?.role).toBe("operator");

  const operatorContext = await browser.newContext();
  const operatorPage = await operatorContext.newPage();
  await operatorPage.goto("/login");
  await operatorPage.getByLabel("Login ID").fill(loginId);
  await operatorPage.getByLabel("Password", { exact: true }).fill(password);
  await operatorPage.getByRole("button", { name: "Sign in" }).click();
  await operatorPage.waitForURL((url) => !url.pathname.startsWith("/login"));
  await expect(operatorPage.getByRole("link", { name: "Users" })).toHaveCount(
    0,
  );
  expect((await operatorPage.request.get("/api/v1/users")).status()).toBe(403);
  await operatorPage.goto("/users");
  await expect(operatorPage).toHaveURL(/\/skill/);

  const deactivate = await page.request.patch(`/api/v1/users/${created.id}`, {
    data: { active: false },
  });
  expect(deactivate.status()).toBe(200);
  expect((await operatorPage.request.get("/api/v1/skills")).status()).toBe(401);
  await operatorContext.close();
});
