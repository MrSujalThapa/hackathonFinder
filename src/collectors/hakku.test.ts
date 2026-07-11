import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHakkuCards } from "@/collectors/hakku";

describe("parseHakkuCards", () => {
  it("parses visible card data into RawLead objects", () => {
    const leads = parseHakkuCards(
      [
        {
          title: "Agent Commerce Hackathon",
          url: "https://example.com/agent-hack",
          text: "Build AI agents for commerce workflows.",
          links: ["https://example.com/agent-hack/apply"],
          tags: ["AI", "Online"],
        },
      ],
      5,
    );

    assert.equal(leads.length, 1);
    assert.equal(leads[0]?.source, "hakku");
    assert.equal(leads[0]?.metadata?.mode, "online");
  });

  it("dedupes cards by URL", () => {
    const leads = parseHakkuCards(
      [
        {
          title: "Duplicate Hack",
          url: "https://example.com/hack",
          links: ["https://example.com/hack"],
          tags: [],
        },
        {
          title: "Duplicate Hack Copy",
          url: "https://example.com/hack/",
          links: ["https://example.com/hack/"],
          tags: [],
        },
      ],
      5,
    );

    assert.equal(leads.length, 1);
  });
});
