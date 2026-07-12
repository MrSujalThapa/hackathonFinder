import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashOwnerPassword, verifyOwnerPassword } from "@/lib/auth/password";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session";

describe("owner auth primitives", () => {
  it("hashes and verifies owner passwords", () => {
    const hash = hashOwnerPassword("correct-password-123");
    assert.ok(hash.startsWith("scrypt$"));
    assert.equal(verifyOwnerPassword("correct-password-123", hash), true);
    assert.equal(verifyOwnerPassword("wrong-password-123", hash), false);
  });

  it("creates signed expiring session tokens", async () => {
    const secret = "a".repeat(40);
    const token = await createSessionToken(secret, 100);
    assert.equal(await verifySessionToken(token, secret, 101), true);
    assert.equal(await verifySessionToken(token, secret, 100 + 60 * 60 * 13), false);
    assert.equal(await verifySessionToken(`${token}x`, secret, 101), false);
  });
});
