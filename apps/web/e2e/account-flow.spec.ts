import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("connection errors keep sign-in and sign-out recoverable", async ({
  page,
}) => {
  await page.goto("/login");
  await page
    .getByLabel("Login ID")
    .fill(process.env.SKILLED_E2E_LOGIN_ID ?? "admin");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.SKILLED_E2E_PASSWORD ?? "skilled-local");
  await page.route("**/api/v1/auth/login", (route) => route.abort());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".error-box[role=alert]")).toContainText(
    "Could not reach SkillEd",
  );
  await expect(page.getByLabel("Login ID")).not.toBeEmpty();
  await page.unroute("**/api/v1/auth/login");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/skill/);
  await page.route("**/api/v1/auth/logout", (route) => route.abort());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator(".studio-rail-bottom [role=alert]")).toContainText(
    "Could not sign out",
  );
  await expect(page).toHaveURL(/\/skill/);
  await page.unroute("**/api/v1/auth/logout");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  expect((await page.request.get("/api/v1/skills")).status()).toBe(401);
});

test("invited signup, login, password change, recovery and deactivation work through the browser", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto("/users");
  const suffix = `${info.project.name}-${Date.now()}`;
  const loginId = `join-${suffix}`;
  const password = `Signup-${suffix}-password`;
  const changedPassword = `Changed-${suffix}-password`;
  const recoveredPassword = `Recovered-${suffix}-password`;
  await page.getByLabel("Invitation name").fill(`Manual journey ${suffix}`);
  await page.getByRole("button", { name: "Create signup link" }).click();
  const linkField = page.getByLabel("Private account link");
  await expect(linkField).toHaveValue(/\/signup#token=[a-f0-9]{64}$/);
  const link = await linkField.inputValue();
  const context = await browser.newContext({
    viewport: info.project.use.viewport,
  });
  const member = await context.newPage();
  try {
    await member.goto(link);
    await expect(
      member.getByRole("heading", { name: "Create your account" }),
    ).toBeVisible();
    await member
      .getByLabel("Display name", { exact: true })
      .fill(`Joined ${suffix}`);
    await member
      .getByLabel("Login ID", { exact: true })
      .fill(loginId.toUpperCase());
    await member.getByLabel("New password", { exact: true }).fill(password);
    await member
      .getByLabel("Confirm password", { exact: true })
      .fill(password + "-wrong");
    await member
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(member.locator(".error-box[role=alert]")).toContainText(
      "Passwords do not match",
    );
    await member.getByLabel("Confirm password", { exact: true }).fill(password);
    await member
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(
      member.getByRole("heading", { name: "Your account is ready" }),
    ).toBeVisible();
    await member.getByRole("link", { name: "Continue to sign in" }).click();
    await expect(member.getByLabel("Login ID")).toHaveValue(loginId);
    await member
      .getByLabel("Password", { exact: true })
      .fill("incorrect-password");
    await member.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(member.locator(".error-box[role=alert]")).toContainText(
      "incorrect",
    );
    await member.getByLabel("Password", { exact: true }).fill(password);
    await member
      .getByRole("button", { name: "Show password", exact: true })
      .click();
    await expect(
      member.getByLabel("Password", { exact: true }),
    ).toHaveAttribute("type", "text");
    await member
      .getByRole("button", { name: "Hide password", exact: true })
      .click();
    await member.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(member).toHaveURL(/\/skill/);
    expect((await member.request.get("/api/v1/users")).status()).toBe(403);
    await member.goto("/account");
    await member.getByLabel("Current password", { exact: true }).fill(password);
    await member
      .getByLabel("New password", { exact: true })
      .fill(changedPassword);
    await member
      .getByLabel("Confirm password", { exact: true })
      .fill(changedPassword);
    await member
      .getByRole("button", { name: "Change password and sign out" })
      .click();
    await expect(member).toHaveURL(/\/login\?passwordChanged=1/);
    await member.getByLabel("Login ID").fill(loginId);
    await member.getByLabel("Password", { exact: true }).fill(changedPassword);
    await member.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(member).toHaveURL(/\/skill/);
    await page.reload();
    await page
      .getByText("Help someone reset their password", { exact: true })
      .click();
    const accounts = (await (await page.request.get("/api/v1/users")).json())
      .users;
    const user = accounts.find((u: any) => u.login_id === loginId);
    await page.getByLabel("Account to recover").selectOption(user.id);
    await page
      .getByRole("button", { name: "Create reset link", exact: true })
      .click();
    await expect(linkField).toHaveValue(/\/reset-password#token=[a-f0-9]{64}$/);
    const resetLink = await linkField.inputValue();
    await member.goto(resetLink);
    await member
      .getByLabel("New password", { exact: true })
      .fill(recoveredPassword);
    await member
      .getByLabel("Confirm password", { exact: true })
      .fill(recoveredPassword);
    await member
      .getByRole("button", { name: "Set new password", exact: true })
      .click();
    await expect(
      member.getByRole("heading", { name: "Password updated" }),
    ).toBeVisible();
    expect((await member.request.get("/api/v1/skills")).status()).toBe(401);
    await member.getByRole("link", { name: "Continue to sign in" }).click();
    await member.getByLabel("Login ID").fill(loginId);
    await member
      .getByLabel("Password", { exact: true })
      .fill(recoveredPassword);
    await member.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(member).toHaveURL(/\/skill/);
    await page.request.patch(`/api/v1/users/${user.id}`, {
      data: { active: false },
    });
    await member.reload();
    await expect(member).toHaveURL(/\/login/);
    await member.getByLabel("Login ID").fill(loginId);
    await member
      .getByLabel("Password", { exact: true })
      .fill(recoveredPassword);
    await member.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(member.locator(".error-box[role=alert]")).toContainText(
      "incorrect",
    );
    await page.request.patch(`/api/v1/users/${user.id}`, {
      data: { active: true },
    });
    await member.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(member).toHaveURL(/\/skill/);
    await member.goto(link);
    await member.getByLabel("Display name").fill("Reused invitation");
    await member.getByLabel("Login ID").fill(`reuse-${suffix}`);
    await member.getByLabel("New password", { exact: true }).fill(password);
    await member.getByLabel("Confirm password", { exact: true }).fill(password);
    await member
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(member.locator(".error-box[role=alert]")).toContainText(
      "used, or revoked",
    );
    await member.goto("/forgot-password");
    await expect(
      member.getByText("SkillEd does not send recovery emails.", {
        exact: false,
      }),
    ).toBeVisible();
    expect(
      await member.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await context.close();
  }
});

test("public account pages remain accessible by keyboard and unauthenticated APIs remain protected", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Login ID").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Show password" }),
  ).toBeFocused();
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(
    page.getByRole("button", { name: "Create account", exact: true }),
  ).toBeDisabled();
  expect((await page.request.get("/api/v1/users")).status()).toBe(401);
  expect(
    (
      await page.request.post("/api/v1/auth/signup", {
        data: { loginId: "no-invite", password: "no-invitation-password" },
      })
    ).status(),
  ).toBe(400);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
