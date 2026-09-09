import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./passwords";
test("password hashing preserves long and Unicode passwords, uses salts, and rejects invalid formats", async () => {
  const password = "a".repeat(80) + "界 secret";
  const first = await hashPassword(password);
  assert.notEqual(first, await hashPassword(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(
    await verifyPassword("a".repeat(80) + "different", first),
    false,
  );
  assert.equal(await verifyPassword(password, "scrypt-v1:bad:hash"), false);
});
