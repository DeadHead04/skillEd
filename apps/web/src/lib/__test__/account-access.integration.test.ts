import test from "node:test";
import assert from "node:assert/strict";
import { db, migrate, closeDatabases } from "@skilled/core";
import { NextRequest } from "next/server";
const url = process.env.SKILLED_TEST_DATABASE_URL;
test(
  "account lifecycle: invitation, login, recovery, temporary passwords and revocation",
  { skip: !url },
  async (t) => {
    if (!new URL(url!).pathname.includes("skilled_test"))
      throw new Error("Use a disposable skilled_test database");
    const owner = db(url);
    const schema = `accounts_${crypto.randomUUID().replaceAll("-", "")}`;
    await owner.unsafe(`CREATE SCHEMA ${schema}`);
    const testUrl = new URL(url!);
    testUrl.searchParams.set("search_path", `${schema},public`);
    process.env.DATABASE_URL = testUrl.toString();
    process.env.SKILLED_SESSION_SECRET =
      "synthetic-account-test-session-secret-only";
    process.env.SKILLED_ADMIN_PASSWORD = "Synthetic-admin-password-only";
    const sql = db();
    try {
      await migrate(sql);
      const login = await import("../../app/api/v1/auth/login/route");
      const signup = await import("../../app/api/v1/auth/signup/route");
      const reset = await import("../../app/api/v1/auth/reset-password/route");
      const change = await import("../../app/api/v1/auth/password/route");
      const links = await import("../../app/api/v1/users/access-links/route");
      const users = await import("../../app/api/v1/users/route");
      const { proxy } = await import("../../proxy");
      const { digestToken } = await import("../account-access");
      const request = (path: string, body: unknown, actor?: any) =>
        new Request(`http://localhost/api/v1/${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(actor
              ? {
                  "x-skilled-user-id": actor.id,
                  "x-skilled-login-id": actor.login_id,
                  "x-skilled-display-name": "Test user",
                  "x-skilled-user-role": actor.role,
                }
              : {}),
          },
          body: JSON.stringify(body),
        });
      const signIn = (loginId: string, password: string) =>
        login.POST(request("auth/login", { loginId, password }));
      const rootResponse = await signIn(
        "admin",
        process.env.SKILLED_ADMIN_PASSWORD!,
      );
      assert.equal(rootResponse.status, 200);
      const [admin] =
        await sql`SELECT id,login_id,role FROM users WHERE login_id='admin'`;
      const issue = async (
        kind: "invitation" | "password_reset",
        extra: any = {},
      ) => {
        const response = await links.POST(
          request(
            "users/access-links",
            { kind, label: "Test invitation", ...extra },
            admin,
          ),
        );
        assert.equal(response.status, 201);
        const value = await response.json();
        return {
          ...value,
          token: new URLSearchParams(value.path.split("#")[1]).get("token")!,
        };
      };
      let invitation: any,
        member: any,
        memberCookie = "";
      const password = "Synthetic-member-password";
      const fields = (token: string, loginId = "member") => ({
        token,
        loginId,
        displayName: "Member",
        password,
        confirmPassword: password,
      });
      await t.test(
        "signup requires a valid unused invitation and refuses role escalation and duplicate IDs",
        async () => {
          assert.equal(
            (await signup.POST(request("auth/signup", fields("0".repeat(64)))))
              .status,
            410,
          );
          invitation = await issue("invitation");
          assert.equal(
            (
              await signup.POST(
                request("auth/signup", {
                  ...fields(invitation.token),
                  confirmPassword: "different",
                }),
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await signup.POST(
                request("auth/signup", fields(invitation.token, "ADMIN")),
              )
            ).status,
            409,
          );
          const results = await Promise.all(
            ["member", "other-member"].map((id) =>
              signup.POST(
                request("auth/signup", {
                  ...fields(invitation.token, id),
                  role: "administrator",
                }),
              ),
            ),
          );
          assert.deepEqual(results.map((r) => r.status).sort(), [201, 410]);
          [member] = await sql`SELECT * FROM users WHERE role='operator'`;
          assert.ok(member);
          assert.equal(member.password_change_required, false);
          const [stored] =
            await sql`SELECT token_hash FROM account_tokens WHERE id=${invitation.id}`;
          assert.equal(stored!.token_hash, digestToken(invitation.token));
          assert.notEqual(stored!.token_hash, invitation.token);
        },
      );
      await t.test(
        "expired, revoked links and inactive issuing administrators cannot grant access",
        async () => {
          const expired = await issue("invitation");
          await sql`UPDATE account_tokens SET expires_at=now()-interval '1 second' WHERE id=${expired.id}`;
          assert.equal(
            (
              await signup.POST(
                request("auth/signup", fields(expired.token, "expired")),
              )
            ).status,
            410,
          );
          const revoked = await issue("invitation");
          await links.DELETE(
            request("users/access-links", { id: revoked.id }, admin),
          );
          assert.equal(
            (
              await signup.POST(
                request("auth/signup", fields(revoked.token, "revoked")),
              )
            ).status,
            410,
          );
          const suspended = await issue("invitation");
          await sql`UPDATE users SET active=false WHERE id=${admin!.id}`;
          assert.equal(
            (
              await signup.POST(
                request("auth/signup", fields(suspended.token, "suspended")),
              )
            ).status,
            410,
          );
          await sql`UPDATE users SET active=true WHERE id=${admin!.id}`;
        },
      );
      await t.test(
        "login normalizes IDs, returns private cookies, enforces roles and blocks forged/cross-site identity",
        async () => {
          const response = await signIn(
            member.login_id.toUpperCase(),
            password,
          );
          assert.equal(response.status, 200);
          const cookie = response.headers.get("set-cookie")!;
          assert.match(cookie, /HttpOnly/i);
          assert.match(cookie, /SameSite=strict/i);
          memberCookie = cookie.split(";")[0]!;
          assert.equal(
            (
              await proxy(
                new NextRequest("http://localhost/api/v1/users", {
                  headers: { cookie: memberCookie },
                }),
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await links.POST(
                request(
                  "users/access-links",
                  { kind: "invitation", label: "forbidden" },
                  member,
                ),
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await proxy(
                new NextRequest("http://localhost/api/v1/users", {
                  headers: {
                    "x-skilled-user-role": "administrator",
                    "x-skilled-user-id": admin!.id,
                  },
                }),
              )
            ).status,
            401,
          );
          assert.equal(
            (
              await proxy(
                new NextRequest("http://localhost/api/v1/auth/login", {
                  method: "POST",
                  headers: {
                    host: "localhost",
                    origin: "https://attacker.invalid",
                  },
                }),
              )
            ).status,
            403,
          );
        },
      );
      await t.test(
        "concurrent incorrect logins lock the normalized account and block even a correct password until recovery",
        async () => {
          const attempts = await Promise.all(
            Array.from({ length: 5 }, () =>
              signIn(member.login_id, "incorrect-password"),
            ),
          );
          assert.ok(attempts.every((r) => r.status === 401));
          assert.equal((await signIn(member.login_id, password)).status, 429);
          assert.equal(
            Number(
              (
                await sql`SELECT failed_count FROM auth_login_attempts WHERE login_id=${member.login_id}`
              )[0]!.failed_count,
            ),
            5,
          );
        },
      );
      let newPassword = "Recovered-member-password";
      await t.test(
        "reset links replace previous links, revoke old sessions, clear lockout and can be used only once",
        async () => {
          const old = await issue("password_reset", { userId: member.id });
          const fresh = await issue("password_reset", { userId: member.id });
          const body = (token: string) => ({
            token,
            password: newPassword,
            confirmPassword: newPassword,
          });
          assert.equal(
            (await reset.POST(request("auth/reset-password", body(old.token))))
              .status,
            410,
          );
          const responses = await Promise.all(
            [1, 2].map(() =>
              reset.POST(request("auth/reset-password", body(fresh.token))),
            ),
          );
          assert.deepEqual(responses.map((r) => r.status).sort(), [200, 410]);
          assert.equal(
            (
              await proxy(
                new NextRequest("http://localhost/api/v1/skills", {
                  headers: { cookie: memberCookie },
                }),
              )
            ).status,
            401,
          );
          assert.equal((await signIn(member.login_id, password)).status, 401);
          const response = await signIn(member.login_id, newPassword);
          assert.equal(response.status, 200);
          memberCookie = response.headers.get("set-cookie")!.split(";")[0]!;
        },
      );
      await t.test(
        "self-service password change checks current password and revokes reset links and sessions",
        async () => {
          const link = await issue("password_reset", { userId: member.id });
          const input = {
            currentPassword: "incorrect-password",
            password: "Changed-member-password",
            confirmPassword: "Changed-member-password",
          };
          assert.equal(
            (await change.POST(request("auth/password", input, member))).status,
            403,
          );
          assert.equal(
            (
              await change.POST(
                request(
                  "auth/password",
                  { ...input, currentPassword: newPassword },
                  member,
                ),
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await proxy(
                new NextRequest("http://localhost/api/v1/skills", {
                  headers: { cookie: memberCookie },
                }),
              )
            ).status,
            401,
          );
          assert.equal(
            (
              await reset.POST(
                request("auth/reset-password", {
                  token: link.token,
                  password: newPassword,
                  confirmPassword: newPassword,
                }),
              )
            ).status,
            410,
          );
        },
      );
      await t.test(
        "temporary passwords restrict the workbench until changed; legacy bcrypt accounts still sign in",
        async () => {
          const created = await users.POST(
            request(
              "users",
              {
                loginId: "temporary",
                displayName: "Temporary",
                role: "operator",
                password,
              },
              admin,
            ),
          );
          assert.equal(created.status, 201);
          const response = await signIn("temporary", password);
          assert.equal((await response.json()).passwordChangeRequired, true);
          const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
          const denied = await proxy(
            new NextRequest("http://localhost/api/v1/skills", {
              headers: { cookie },
            }),
          );
          assert.equal(denied.status, 403);
          assert.equal((await denied.json()).code, "PASSWORD_CHANGE_REQUIRED");
          await sql`INSERT INTO users(login_id,display_name,role,password_hash) VALUES('legacy','Legacy','operator',crypt(${password},gen_salt('bf',12)))`;
          assert.equal((await signIn("legacy", password)).status, 200);
          const resetLink = await issue("password_reset", {
            userId: member.id,
          });
          await sql`UPDATE users SET active=false,session_version=session_version+1 WHERE id=${member.id}`;
          assert.equal(
            (
              await reset.POST(
                request("auth/reset-password", {
                  token: resetLink.token,
                  password,
                  confirmPassword: password,
                }),
              )
            ).status,
            410,
          );
        },
      );
    } finally {
      await closeDatabases();
      const cleanup = db(url);
      await cleanup.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await cleanup.end();
    }
  },
);
