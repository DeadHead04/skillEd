import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionToken, verifySessionToken } from "../auth";

const secret = "a-test-session-secret-that-is-longer-than-32-characters";
const user = {
  id: "6b680ac5-710c-4f64-ae65-a0d58980ffdf",
  role: "administrator" as const,
  sessionVersion: 3,
};

describe("named user sessions", () => {
  it("round-trips signed identity, role, and revocation version", async () => {
    const token = await createSessionToken(user, secret);
    assert.deepEqual(await verifySessionToken(token, secret), {
      userId: user.id,
      role: user.role,
      sessionVersion: 3,
      expiresAt: Number(token.split(".")[4]),
    });
  });

  it("rejects tampering, expiration, and the old shared-password token", async () => {
    const token = await createSessionToken(user, secret);
    assert.equal(
      await verifySessionToken(
        token.replace("administrator", "operator"),
        secret,
      ),
      null,
    );
    assert.equal(
      await verifySessionToken("v1.9999999999.invalid", secret),
      null,
    );
    assert.equal(
      await verifySessionToken(
        await createSessionToken(user, secret, -1),
        secret,
      ),
      null,
    );
  });
});
