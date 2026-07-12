import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeOwnerPasswordHashB64,
  encodeOwnerPasswordHashB64,
  hashOwnerPassword,
  resolveOwnerPasswordHash,
  verifyOwnerPassword,
} from "@/lib/auth/password";

describe("owner password hash", () => {
  it("verifies B64-encoded hashes", () => {
    const raw = hashOwnerPassword("correct-horse-battery");
    const b64 = encodeOwnerPasswordHashB64(raw);
    const decoded = decodeOwnerPasswordHashB64(b64);
    assert.equal(decoded, raw);
    assert.equal(verifyOwnerPassword("correct-horse-battery", decoded!), true);
    assert.equal(verifyOwnerPassword("wrong-password-xx", decoded!), false);
  });

  it("prefers B64 over legacy when both exist", () => {
    const raw = hashOwnerPassword("correct-horse-battery");
    const b64 = encodeOwnerPasswordHashB64(raw);
    const other = hashOwnerPassword("other-password-12");
    const resolved = resolveOwnerPasswordHash({
      APP_OWNER_PASSWORD_HASH_B64: b64,
      APP_OWNER_PASSWORD_HASH: other,
    });
    assert.equal(resolved?.source, "b64");
    assert.equal(verifyOwnerPassword("correct-horse-battery", resolved!.hash), true);
  });

  it("supports legacy raw/escaped hash values", () => {
    const raw = hashOwnerPassword("legacy-password1");
    const resolved = resolveOwnerPasswordHash({
      APP_OWNER_PASSWORD_HASH: `"${raw}"`,
    });
    assert.equal(resolved?.source, "legacy");
    assert.equal(verifyOwnerPassword("legacy-password1", resolved!.hash), true);
  });

  it("rejects malformed B64", () => {
    assert.throws(
      () =>
        resolveOwnerPasswordHash({
          APP_OWNER_PASSWORD_HASH_B64: "not-valid-scrypt-payload",
        }),
      /malformed/i,
    );
  });

  it("returns null when auth configuration is missing", () => {
    assert.equal(resolveOwnerPasswordHash({}), null);
  });

  it("rejects wrong passwords", () => {
    const raw = hashOwnerPassword("correct-horse-battery");
    assert.equal(verifyOwnerPassword("totally-wrong-pw", raw), false);
  });
});
