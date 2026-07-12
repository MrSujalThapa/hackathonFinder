import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSafePublicHttpUrl, UnsafeUrlError } from "@/core/enrichLead";
import { FetchHtmlError, fetchHtml } from "@/lib/http/fetchHtml";

describe("fetchHtml redirect validation", () => {
  it("validates redirect targets before following them", async () => {
    const fetched: string[] = [];

    await assert.rejects(
      () =>
        fetchHtml("https://public.example/start", {
          retries: 0,
          validateUrl: (url) => assertSafePublicHttpUrl(url),
          fetchImpl: async (url) => {
            fetched.push(String(url));
            return new Response("", {
              status: 302,
              headers: { Location: "http://127.0.0.1/admin" },
            });
          },
        }),
      UnsafeUrlError,
    );

    assert.deepEqual(fetched, ["https://public.example/start"]);
  });

  it("stops reading responses that exceed the byte limit", async () => {
    await assert.rejects(
      () =>
        fetchHtml("https://public.example/large", {
          retries: 0,
          maxBytes: 4,
          fetchImpl: async () =>
            new Response("too large", {
              status: 200,
              headers: { "Content-Type": "text/html" },
            }),
        }),
      (error: unknown) =>
        error instanceof FetchHtmlError &&
        /Response too large/i.test(error.message),
    );
  });
});
