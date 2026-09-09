import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db, migrate } from "./db";
const url = process.env.SKILLED_TEST_DATABASE_URL;
test(
  "restricted runtime database roles cannot migrate, read login data or rewrite immutable history",
  { skip: !url },
  async () => {
    if (!new URL(url!).pathname.includes("skilled_test"))
      throw new Error("Use a disposable skilled_test database");
    const admin = db(url);
    const name = `skilled_test_roles_${crypto.randomUUID().replaceAll("-", "")}`;
    const originalRoles =
      await admin`SELECT rolname FROM pg_roles WHERE rolname IN ('skilled_web','skilled_controller')`;
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const migrationUrl = new URL(url!);
    migrationUrl.pathname = `/${name}`;
    const owner = db(migrationUrl.toString());
    const password = crypto.randomUUID() + crypto.randomUUID();
    const connections = [] as ReturnType<typeof db>[];
    try {
      await migrate(owner);
      await promisify(execFile)(
        process.execPath,
        ["--import", "tsx", "packages/core/src/roles.ts"],
        {
          env: {
            ...process.env,
            MIGRATION_DATABASE_URL: migrationUrl.toString(),
            SKILLED_WEB_DB_PASSWORD: password,
            SKILLED_CONTROLLER_DB_PASSWORD: password,
          },
        },
      );
      for (const role of ["skilled_web", "skilled_controller"]) {
        const runtimeUrl = new URL(migrationUrl);
        runtimeUrl.username = role;
        runtimeUrl.password = password;
        const runtime = db(runtimeUrl.toString());
        connections.push(runtime);
        assert.equal(
          Number(
            (await runtime`SELECT count(*) FROM schema_migrations`)[0]!.count,
          ),
          7,
        );
        await assert.rejects(
          runtime`CREATE TABLE forbidden(id integer)`,
          /permission denied/,
        );
        await assert.rejects(
          runtime`UPDATE schema_migrations SET version=999`,
          /permission denied/,
        );
        if (role === "skilled_controller") {
          await assert.rejects(
            runtime`SELECT password_hash FROM users`,
            /permission denied/,
          );
          await assert.rejects(
            runtime`SELECT token_hash FROM account_tokens`,
            /permission denied/,
          );
        } else {
          const [user] =
            await runtime`INSERT INTO users(login_id,display_name,role,password_hash) VALUES('role-admin','Role administrator','administrator','synthetic-unusable-hash') RETURNING id`;
          const [link] =
            await runtime`INSERT INTO account_tokens(token_hash,kind,created_by,expires_at) VALUES(${"a".repeat(64)},'invitation',${user!.id},now()+interval '1 hour') RETURNING id`;
          await runtime`UPDATE account_tokens SET revoked_at=now() WHERE id=${link!.id}`;
          const [skill] =
            await runtime`INSERT INTO skills(name) VALUES('least-privilege') RETURNING id`;
          const [version] =
            await runtime`INSERT INTO skill_versions(skill_id,version,name,selected_root,checksum,original_key) VALUES(${skill!.id},1,'least-privilege','','checksum','fixture.zip') RETURNING id`;
          await assert.rejects(
            runtime`UPDATE skill_versions SET checksum='changed' WHERE id=${version!.id}`,
            /permission denied|Immutable/,
          );
        }
      }
    } finally {
      await Promise.all(connections.map((c) => c.end()));
      await owner.end();
      await admin.unsafe(`DROP DATABASE ${name}`);
      for (const role of ["skilled_web", "skilled_controller"])
        if (!originalRoles.some((r) => r.rolname === role))
          await admin.unsafe(`DROP ROLE ${role}`);
      await admin.end();
    }
  },
);
