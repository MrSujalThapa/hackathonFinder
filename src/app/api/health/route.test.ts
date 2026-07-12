import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns a redacted public health response", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "secret-service-role-key";
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"secret@example.com"}';
    const response = await GET(new Request("http://localhost/api/health"));
    assert.equal(response.status, 200);

    const text = await response.text();
    assert.match(text, /"status"/);
    assert.doesNotMatch(text, /secret-service-role-key/);
    assert.doesNotMatch(text, /secret@example.com/);
    assert.doesNotMatch(text, /supabase\.co/);
  });
});
