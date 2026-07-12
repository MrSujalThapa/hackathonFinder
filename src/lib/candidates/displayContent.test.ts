import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DISPLAY_CONTENT_FALLBACK,
  buildSentenceSourceSummary,
  cleanDisplayText,
  getDetailDescription,
  getQueueSummary,
  resolveDisplaySource,
  truncateToSentences,
} from "./displayContent";

/** Realistic scraped / stored fixtures for display cleanup. */
const FIXTURES = {
  verifiedSummary:
    "HackAI Toronto is a student AI hackathon focused on agent tooling. Teams ship a working prototype over one weekend.",
  cleanedDescription:
    "Participants build AI agent prototypes with mentor support. Tracks include climate, health, and civic tech. Prizes are awarded for impact and technical depth.",
  markdownMess: `# Eligibility

## Who can apply

- Students and recent grads
- * Remote builders welcome
• • Must follow rules

HackAI Toronto runs in Toronto with agent tracks.`,
  cocBlob: `Build useful agents this weekend. Code of Conduct: By participating, you agree to follow the MLH Code of Conduct. Harassment will not be tolerated. We are committed to providing a safe and inclusive environment. Please report violations to organizers@example.com. Be excellent to each other.`,
  navDevpost: `Skip to content Navigation: Home > Events Build climate agents. Find your next hackathon on Devpost. Browse hackathons. Privacy Policy. Log in | Sign up`,
  repeatedMeta:
    "HackTO AI Challenge. Toronto, Canada. Sep 13, 2026. HackTO AI Challenge returns to Toronto, Canada on Sep 13, 2026 with agent tracks.",
  partialCut:
    "Teams prototype agent workflows with cloud credits and mentor office hours for machine-learni",
  malformedBullets: `Overview of the weekend

-

* 

- Ship a demo by Sunday
• Judging is Sunday evening
`,
  shortNoise: "Hi · ·",
  longDescription: Array.from(
    { length: 8 },
    (_, i) => `Sentence number ${i + 1} about the event.`,
  ).join(" "),
  htmlScrap: "<p>Build with <strong>agents</strong>&nbsp;and cloud.</p><div>Nav: Home</div>",
  sourceExcerpt:
    "Organizers host a 36-hour build in downtown Toronto. Mentors from local labs support teams. Final demos are open to the public.",
} as const;

describe("displayContent", () => {
  it("strips Devpost boilerplate", () => {
    const cleaned = cleanDisplayText(FIXTURES.navDevpost);
    assert.ok(!/devpost/i.test(cleaned));
    assert.ok(!/browse hackathons/i.test(cleaned));
    assert.match(cleaned, /Build climate agents/i);
  });

  it("removes organizer marketing filler", () => {
    const raw =
      "Ship a useful prototype over the weekend. Register now! Limited spots available. Don't miss out.";
    const cleaned = cleanDisplayText(raw);
    assert.ok(!/register now/i.test(cleaned));
    assert.ok(!/limited spots/i.test(cleaned));
    assert.match(cleaned, /prototype/i);
  });

  it("strips markdown headings", () => {
    const cleaned = cleanDisplayText(FIXTURES.markdownMess, {
      title: "HackAI Toronto",
    });
    assert.ok(!/#/.test(cleaned));
    assert.ok(!/Eligibility/i.test(cleaned) || !cleaned.trimStart().startsWith("#"));
    assert.match(cleaned, /Students and recent grads/i);
    assert.match(cleaned, /agent tracks/i);
  });

  it("removes Code of Conduct boilerplate", () => {
    const cleaned = cleanDisplayText(FIXTURES.cocBlob);
    assert.ok(!/code of conduct/i.test(cleaned));
    assert.ok(!/harassment/i.test(cleaned));
    assert.ok(!/be excellent/i.test(cleaned));
    assert.match(cleaned, /Build useful agents/i);
  });

  it("removes navigation text", () => {
    const cleaned = cleanDisplayText(FIXTURES.navDevpost);
    assert.ok(!/skip to content/i.test(cleaned));
    assert.ok(!/Navigation:/i.test(cleaned));
  });

  it("removes repeated title/date/location", () => {
    const cleaned = cleanDisplayText(FIXTURES.repeatedMeta, {
      title: "HackTO AI Challenge",
      location: "Toronto, Canada",
      dateText: "Sep 13, 2026",
    });
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

  it("strips malformed bullets while keeping item text", () => {
    const cleaned = cleanDisplayText(FIXTURES.malformedBullets);
    assert.ok(!/^[-*•]/m.test(cleaned));
    assert.match(cleaned, /Ship a demo by Sunday/i);
    assert.match(cleaned, /Judging is Sunday evening/i);
  });

  it("strips partial trailing words from cut-off scrapes", () => {
    const cleaned = cleanDisplayText(FIXTURES.partialCut);
    assert.ok(!/machine-learni/i.test(cleaned));
    assert.match(cleaned, /mentor office hours/i);
  });

  it("sentence-safe truncates long descriptions to 2–3 sentences", () => {
    const out = truncateToSentences(FIXTURES.longDescription, {
      maxSentences: 3,
      maxChars: 200,
    });
    assert.ok(!out.includes("Sentence number 5"));
    assert.ok(!/\w…\w/.test(out));
    assert.match(out, /Sentence number 1/);
    const sentenceCount = (out.match(/[.!?]/g) ?? []).length;
    assert.ok(sentenceCount <= 3);
  });

  it("does not mid-word truncate a single long sentence", () => {
    const word = "abcdefghij";
    const long = Array.from({ length: 80 }, () => word).join(" ");
    const out = truncateToSentences(long, { maxSentences: 2, maxChars: 60 });
    assert.ok(out.endsWith("…"));
    const before = out.slice(0, -1).trimEnd();
    assert.ok(!before.endsWith("abcde"));
    assert.ok(before.split(/\s+/).every((w) => w === word || w.length === 0 || w === word));
  });

  it("returns fallback for missing description", () => {
    assert.equal(
      getQueueSummary({ name: "X", summary: null, description: null }),
      DISPLAY_CONTENT_FALLBACK,
    );
    assert.deepEqual(getDetailDescription({ name: "X" }), [DISPLAY_CONTENT_FALLBACK]);
  });

  it("strips HTML remnants", () => {
    const cleaned = cleanDisplayText(FIXTURES.htmlScrap);
    assert.ok(!/</.test(cleaned));
    assert.ok(!/&nbsp;/i.test(cleaned));
    assert.match(cleaned, /Build with agents/i);
  });

  it("prefers verified grounded summary for queue", () => {
    const resolved = resolveDisplaySource({
      name: "Event",
      summary: FIXTURES.verifiedSummary,
      description: "Raw directory scrap | Find your next hackathon | more noise here forever.",
    });
    assert.equal(resolved.kind, "verified_summary");

    const summary = getQueueSummary({
      name: "Event",
      summary: FIXTURES.verifiedSummary,
      description: "Raw directory scrap | Find your next hackathon | more noise here forever.",
    });
    assert.match(summary, /HackAI Toronto/i);
    assert.ok(!/Find your next hackathon/i.test(summary));
    const sentenceCount = (summary.match(/[.!?]/g) ?? []).length;
    assert.ok(sentenceCount >= 2 && sentenceCount <= 3);
  });

  it("falls back to cleaned description when summary is unusable", () => {
    const resolved = resolveDisplaySource({
      name: "Event",
      summary: FIXTURES.shortNoise,
      description: FIXTURES.cleanedDescription,
    });
    assert.equal(resolved.kind, "cleaned_description");
    const summary = getQueueSummary({
      name: "Event",
      summary: FIXTURES.shortNoise,
      description: FIXTURES.cleanedDescription,
    });
    assert.match(summary, /AI agent prototypes/i);
  });

  it("uses sentence-level source summary when summary and description fail", () => {
    const resolved = resolveDisplaySource({
      name: "Event",
      summary: "ok",
      description: "## CoC\nCode of Conduct: By participating, you agree to follow the MLH Code of Conduct.",
      sourceSummary: FIXTURES.sourceExcerpt,
    });
    assert.equal(resolved.kind, "sentence_source");
    const summary = getQueueSummary({
      name: "Event",
      summary: "ok",
      description: "## CoC\nCode of Conduct: By participating, you agree to follow the MLH Code of Conduct.",
      sourceSummary: FIXTURES.sourceExcerpt,
    });
    assert.match(summary, /36-hour build/i);
    assert.ok(!/code of conduct/i.test(summary));
  });

  it("builds sentence source summary from complete sentences only", () => {
    const out = buildSentenceSourceSummary(
      "Complete opener about the weekend. Another finished line about mentors. dangling cuto",
    );
    assert.match(out, /Complete opener/i);
    assert.ok(!/dangling cuto/i.test(out));
  });

  it("detail returns readable paragraphs", () => {
    const paragraphs = getDetailDescription({
      name: "Event",
      description: FIXTURES.longDescription,
    });
    assert.ok(paragraphs.length >= 1);
    assert.ok(paragraphs.every((p) => p.length > 10));
  });

  it("detail prefers verified summary over noisy description", () => {
    const paragraphs = getDetailDescription({
      name: "Event",
      summary: FIXTURES.verifiedSummary,
      description: FIXTURES.markdownMess,
    });
    assert.equal(paragraphs.length, 1);
    assert.match(paragraphs[0]!, /student AI hackathon/i);
    assert.ok(!/#/.test(paragraphs[0]!));
  });

  it("queue summary caps at three sentences", () => {
    const summary = getQueueSummary({
      name: "Event",
      description: FIXTURES.longDescription,
    });
    const sentenceCount = (summary.match(/[.!?]/g) ?? []).length;
    assert.ok(sentenceCount <= 3);
    assert.ok(!summary.includes("Sentence number 5"));
  });
});
