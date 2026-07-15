import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { fetchCandidates } from "@/lib/api/candidates";

function okResponse() {
  return Response.json({
    data: {
      candidates: [],
      nextCursor: null,
      total: 0,
    },
    error: null,
  });
}

describe("fetchCandidates", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("does not send undefined, null, or object-string cursors", async () => {
    const urls: string[] = [];
    mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      urls.push(String(input));
      return okResponse();
    });

    await fetchCandidates({ cursor: "undefined" });
    await fetchCandidates({ cursor: "null" });
    await fetchCandidates({ cursor: "[object Object]" });

    assert.equal(urls.length, 3);
    for (const url of urls) {
      assert.ok(!url.includes("cursor="), url);
    }
  });

  it("sends canonical queue request purpose and source filters", async () => {
    let requestedUrl = "";
    mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return okResponse();
    });

    await fetchCandidates({
      statuses: ["NEW", "NEEDS_REVIEW"],
      limit: 30,
      sort: "score",
      source: "custom:hackathonmap",
      requestPurpose: "queue_initial",
    });

    const params = new URL(requestedUrl, "http://localhost").searchParams;
    assert.equal(params.get("statuses"), "NEW,NEEDS_REVIEW");
    assert.equal(params.get("source"), "custom:hackathonmap");
    assert.equal(params.get("requestPurpose"), "queue_initial");
  });
});
