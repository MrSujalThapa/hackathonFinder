import assert from "node:assert/strict";
import test from "node:test";
import { isSameOriginRequest } from "@/server/api/sameOrigin";

function requestWith(origin: string | null, url: string): Request {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  return new Request(url, { headers });
}

test("same-origin check treats the loopback family as one host", () => {
  assert.equal(isSameOriginRequest(requestWith("http://127.0.0.1:3000", "http://localhost:3000/api/terminal/sessions")), true);
  assert.equal(isSameOriginRequest(requestWith("http://localhost:3000", "http://127.0.0.1:3000/api/terminal/sessions")), true);
  assert.equal(isSameOriginRequest(requestWith("http://[::1]:3000", "http://localhost:3000/api/x")), true);
});

test("same-origin check rejects cross-origin and missing origins", () => {
  assert.equal(isSameOriginRequest(requestWith("https://evil.example", "http://localhost:3000/api/x")), false);
  assert.equal(isSameOriginRequest(requestWith(null, "http://localhost:3000/api/x")), false);
  assert.equal(isSameOriginRequest(requestWith("http://localhost:3001", "http://localhost:3000/api/x")), false);
});

test("same-origin check trusts the configured public base URL host", () => {
  process.env.APP_BASE_URL = "https://owner-tailnet.ts.net";
  try {
    assert.equal(isSameOriginRequest(requestWith("https://owner-tailnet.ts.net", "http://localhost:3000/api/applications")), true);
    assert.equal(isSameOriginRequest(requestWith("https://other.ts.net", "http://localhost:3000/api/applications")), false);
  } finally {
    delete process.env.APP_BASE_URL;
  }
});
