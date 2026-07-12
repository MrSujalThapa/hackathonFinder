import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DISPLAY_CONTENT_FALLBACK,
  cleanDisplayText,
  getDetailDescription,
  getQueueSummary,
  truncateToSentences,
} from "./displayContent.ts";

describe("displayContent", () => {
  it("strips Devpost boilerplate", () => {
    const raw =
      "Build agents for climate. Find your next hackathon on Devpost. Browse hackathons. Privacy Policy.";
    const cleaned = cleanDisplayText(raw);
    assert.ok(!/devpost/i.test(cleaned));
    assert.ok(!/browse hackathons/i.test(cleaned));
    assert.match(cleaned, /Build agents/i);
  });

  it("removes organizer marketing filler", () => {
    const raw =
      "Ship a useful prototype over the weekend. Register now! Limited spots available. Don't miss out.";
    const cleaned = cleanDisplayText(raw);
    assert.ok(!/register now/i.test(cleaned));
    assert.ok(!/limited spots/i.test(cleaned));
    assert.match(cleaned, /prototype/i);
  });

  it("removes repeated title/date/location", () => {
    const cleaned = cleanDisplayText(
      "HackTO AI Challenge. Toronto, Canada. Sep 13, 2026. HackTO AI Challenge returns to Toronto, Canada on Sep 13, 2026 with agent tracks.",
      {
        title: "HackTO AI Challenge",
        location: "Toronto, Canada",
        dateText: "Sep 13, 2026",
      },
    );
    const titleHits = cleaned.match(/HackTO AI Challenge/gi) ?? [];
    assert.ok(titleHits.length <= 1);
    assert.match(cleaned, /agent tracks/i);
  });

  it("normalizes malformed whitespace", () => {
    const cleaned = cleanDisplayText("Hello\n\n\n   world\t\tfrom   agents");
    assert.equal(cleaned.includes("\n\n\n"), false);
    assert.match(cleaned, /Hello/);
    assert.match(cleaned, /world/);
  });

  it("sentence-safe truncates long descriptions", () => {
    const long = Array.from({ length: 8 }, (_, i) => `Sentence number ${i + 1} about the event.`).join(
      " ",
    );
    const out = truncateToSentences(long, { maxSentences: 3, maxChars: 200 });
    assert.ok(!out.includes("Sentence number 5"));
    assert.ok(!/\w…\w/.test(out)); // no mid-word ellipsis sandwich
    assert.match(out, /Sentence number 1/);
  });

  it("does not mid-word truncate a single long sentence", () => {
    const word = "abcdefghij";
    const long = Array.from({ length: 80 }, () => word).join(" ");
    const out = truncateToSentences(long, { maxSentences: 2, maxChars: 60 });
    assert.ok(out.endsWith("…"));
    const before = out.slice(0, -1).trimEnd();
    assert.ok(!before.endsWith("abcde")); // cut on word boundary
    assert.ok(before.split(/\s+/).every((w) => w === word || w.length === 0 || w === word));
  });

  it("returns fallback for missing description", () => {
    assert.equal(getQueueSummary({ name: "X", summary: null, description: null }), DISPLAY_CONTENT_FALLBACK);
    assert.deepEqual(getDetailDescription({ name: "X" }), [DISPLAY_CONTENT_FALLBACK]);
  });

  it("strips HTML remnants", () => {
    const cleaned = cleanDisplayText(
      "<p>Build with <strong>agents</strong>&nbsp;and cloud.</p><div>Nav: Home</div>",
    );
    assert.ok(!/</.test(cleaned));
    assert.ok(!/&nbsp;/i.test(cleaned));
    assert.match(cleaned, /Build with agents/i);
  });

  it("prefers grounded summary for queue", () => {
    const summary = getQueueSummary({
      name: "Event",
      summary: "Grounded summary about AI agents. Remote and open to students.",
      description: "Raw directory scrap | Find your next hackathon | more noise here forever.",
    });
    assert.match(summary, /Grounded summary/i);
    assert.ok(!/Find your next hackathon/i.test(summary));
  });

  it("detail returns readable paragraphs", () => {
    const paragraphs = getDetailDescription({
      name: "Event",
      description:
        "First sentence about the event. Second sentence with more detail. Third sentence continues. Fourth sentence wraps up. Fifth sentence still going.",
    });
    assert.ok(paragraphs.length >= 1);
    assert.ok(paragraphs.every((p) => p.length > 10));
  });
});
