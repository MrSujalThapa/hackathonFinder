import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseServiceAccountJson } from "@/lib/google/config";
import { GoogleSheetsError } from "@/lib/google/types";

describe("parseServiceAccountJson", () => {
  it("rejects invalid JSON", () => {
    assert.throws(
      () => parseServiceAccountJson("{not-json"),
      (error: unknown) =>
        error instanceof GoogleSheetsError && error.code === "invalid_json",
    );
  });

  it("rejects missing client_email", () => {
    assert.throws(
      () =>
        parseServiceAccountJson(
          JSON.stringify({ private_key: "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n" }),
        ),
      (error: unknown) =>
        error instanceof GoogleSheetsError &&
        error.code === "invalid_credentials" &&
        /client_email/i.test(error.message),
    );
  });

  it("rejects missing private_key", () => {
    assert.throws(
      () =>
        parseServiceAccountJson(
          JSON.stringify({ client_email: "sa@example.com" }),
        ),
      (error: unknown) =>
        error instanceof GoogleSheetsError &&
        error.code === "invalid_credentials" &&
        /private_key/i.test(error.message),
    );
  });

  it("unescapes private_key newlines", () => {
    const account = parseServiceAccountJson(
      JSON.stringify({
        client_email: "sa@example.com",
        private_key:
          "-----BEGIN PRIVATE KEY-----\\nLINE1\\nLINE2\\n-----END PRIVATE KEY-----\\n",
      }),
    );

    assert.equal(account.client_email, "sa@example.com");
    assert.ok(account.private_key.includes("\nLINE1\n"));
    assert.ok(!account.private_key.includes("\\n"));
  });
});
