import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyOwnerPassword } from "@/lib/auth/password";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session";

describe("owner auth primitives", () => {
  it("verifies owner passwords", () => {
    assert.equal(
      verifyOwnerPassword("correct-password-123", "correct-password-123"),
      true,
    );
    assert.equal(
      verifyOwnerPassword("wrong-password-123", "correct-password-123"),
      false,
    );
  });

  it("creates signed expiring session tokens", async () => {
    const secret = "a".repeat(40);
    const token = await createSessionToken(secret, 100);
    assert.equal(await verifySessionToken(token, secret, 101), true);
    assert.equal(await verifySessionToken(token, secret, 100 + 60 * 60 * 13), false);
    assert.equal(await verifySessionToken(`${token}x`, secret, 101), false);
  });
});
