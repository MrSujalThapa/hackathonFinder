import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { protectApiRequest } from "@/server/api/protection";

describe("protectApiRequest", () => {
  it("rejects cross-origin mutations", async () => {
    const response = protectApiRequest(
      new Request("http://localhost/api/candidates/1/approve", {
        method: "POST",
        headers: { origin: "https://attacker.example" },
      }),
      { requireSameOrigin: true },
    );

    assert.equal(response?.status, 403);
  });

  it("rejects oversized request bodies", async () => {
    const response = protectApiRequest(
      new Request("http://localhost/api/candidates/1/ask", {
        method: "POST",
        headers: { origin: "http://localhost", "content-length": "999" },
      }),
      { requireSameOrigin: true, maxBodyBytes: 10 },
    );

    assert.equal(response?.status, 413);
  });

  it("rate limits by client key", async () => {
    const first = protectApiRequest(
      new Request("http://localhost/api/candidates/1/ask", {
        method: "POST",
        headers: { origin: "http://localhost", "x-real-ip": "rate-test" },
      }),
      { rateLimit: { key: "test-limit", limit: 1, windowMs: 60_000 } },
    );
    const second = protectApiRequest(
      new Request("http://localhost/api/candidates/1/ask", {
        method: "POST",
        headers: { origin: "http://localhost", "x-real-ip": "rate-test" },
      }),
      { rateLimit: { key: "test-limit", limit: 1, windowMs: 60_000 } },
    );

    assert.equal(first, null);
    assert.equal(second?.status, 429);
  });
});
