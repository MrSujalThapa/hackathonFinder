import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveOwnerPassword, verifyOwnerPassword } from "@/lib/auth/password";

describe("owner app password", () => {
  it("resolves APP_PASSWORD from server env", () => {
    assert.equal(
      resolveOwnerPassword({ APP_PASSWORD: "stable-owner-password" }),
      "stable-owner-password",
    );
  });

  it("fails clearly when APP_PASSWORD is missing", () => {
    assert.throws(() => resolveOwnerPassword({}), /APP_PASSWORD is required/);
    assert.throws(
      () => resolveOwnerPassword({ APP_PASSWORD: "" }),
      /APP_PASSWORD is required/,
    );
  });

  it("verifies stable passwords without generating a hash", () => {
    assert.equal(
      verifyOwnerPassword("correct-horse-battery", "correct-horse-battery"),
      true,
    );
    assert.equal(
      verifyOwnerPassword("totally-wrong-pw", "correct-horse-battery"),
      false,
    );
  });
});
