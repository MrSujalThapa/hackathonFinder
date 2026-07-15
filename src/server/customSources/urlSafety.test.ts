import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSafeCustomSourceUrl,
  normalizeCustomSourceSlug,
} from "@/server/customSources/urlSafety";

describe("custom source URL safety", () => {
  const resolveHost = async () => ["93.184.216.34"];

  it("allows public http and https URLs", async () => {
    const parsed = await assertSafeCustomSourceUrl("https://example.com/events", {
      resolveHost,
    });
    assert.equal(parsed.hostname, "example.com");
  });

  it("rejects unsafe schemes", async () => {
    await assert.rejects(
      () => assertSafeCustomSourceUrl("file:///etc/passwd", { resolveHost }),
      /http and https/i,
    );
  });

  it("rejects localhost and private IP destinations", async () => {
    await assert.rejects(
      () => assertSafeCustomSourceUrl("http://localhost:3000/events", { resolveHost }),
      /internal|local/i,
    );
    await assert.rejects(
      () => assertSafeCustomSourceUrl("http://127.0.0.1/events", { allowRawIp: true, resolveHost }),
      /Private IPv4/i,
    );
  });

  it("rejects DNS resolution to private ranges", async () => {
    await assert.rejects(
      () =>
        assertSafeCustomSourceUrl("https://events.example.test", {
          resolveHost: async () => ["10.0.0.5"],
        }),
      /private IPv4/i,
    );
  });

  it("normalizes slugs", () => {
    assert.equal(normalizeCustomSourceSlug("Hacker Calendar!"), "hacker-calendar");
  });
});
