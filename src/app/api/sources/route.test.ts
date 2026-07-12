import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GET as getSources } from "@/app/api/sources/route";
import { GET as getSource } from "@/app/api/sources/[name]/route";
import { POST as checkSource } from "@/app/api/sources/[name]/check/route";
import { PATCH as patchSettings } from "@/app/api/sources/settings/route";

const ORIGIN = "http://localhost";

describe("GET /api/sources", () => {
  it("returns healthable sources without secrets", async () => {
    const response = await getSources(new Request(`${ORIGIN}/api/sources`));
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /"mlh"/);
    assert.match(text, /"hakku"/);
    assert.doesNotMatch(text, /"x"/);
    assert.doesNotMatch(text, /X_BEARER_TOKEN|SEARCH_API_KEY=|browser-profiles\\hakku/i);
    assert.doesNotMatch(text, /cookie|Bearer sk-/i);
  });
});

describe("GET /api/sources/[name]", () => {
  it("rejects x", async () => {
    const response = await getSource(new Request(`${ORIGIN}/api/sources/x`), {
      params: Promise.resolve({ name: "x" }),
    });
    assert.equal(response.status, 400);
  });

  it("returns a snapshot for mlh", async () => {
    const response = await getSource(new Request(`${ORIGIN}/api/sources/mlh`), {
      params: Promise.resolve({ name: "mlh" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.source, "mlh");
    assert.ok(body.data.capabilities);
  });
});

describe("POST /api/sources/[name]/check", () => {
  it("rejects cross-origin mutations", async () => {
    const response = await checkSource(
      new Request(`${ORIGIN}/api/sources/mlh/check`, {
        method: "POST",
        headers: { origin: "https://evil.example" },
        body: "{}",
      }),
      { params: Promise.resolve({ name: "mlh" }) },
    );
    assert.equal(response.status, 403);
  });

  it("rejects unknown sources without leaking secrets", async () => {
    const response = await checkSource(
      new Request(`${ORIGIN}/api/sources/x/check`, {
        method: "POST",
        headers: { origin: ORIGIN },
        body: "{}",
      }),
      { params: Promise.resolve({ name: "x" }) },
    );
    assert.equal(response.status, 400);
    const text = await response.text();
    assert.doesNotMatch(text, /Bearer|cookie|profile path/i);
  });
});

describe("PATCH /api/sources/settings", () => {
  it("rejects unknown source keys", async () => {
    const response = await patchSettings(
      new Request(`${ORIGIN}/api/sources/settings`, {
        method: "PATCH",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ enabled: { x: true } }),
      }),
    );
    assert.equal(response.status, 400);
  });
});
