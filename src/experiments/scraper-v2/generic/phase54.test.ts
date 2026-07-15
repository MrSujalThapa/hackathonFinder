import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { createFakeLlmProvider } from "@/lib/llm/providers/fake";
import {
  buildAiPageDecisionInput,
  validateAiPageDecision,
} from "@/experiments/scraper-v2/generic/aiPageDecision";
import { runGenericStructuredExtraction } from "@/experiments/scraper-v2/generic/structuredExtraction";
import type { AcquiredArtifact, SourceExperiment } from "@/experiments/scraper-v2/generic/types";

function source(): SourceExperiment {
  return {
    inputUrl: "https://events.example/list",
    allowedOrigins: ["https://events.example"],
    maxRequests: 10,
    maxPages: 2,
    maxBrowserActions: 0,
    maxPayloadBytes: 500_000,
    browserAllowed: false,
    expectedContentCategory: "public_event_directory",
  };
}

function artifact(html: string): AcquiredArtifact {
  return {
    artifactId: "html:0",
    kind: "html",
    sourceUrl: "https://events.example/list",
    payload: { html },
    byteSize: html.length,
    acquisitionMode: "static",
    timingMs: 1,
  };
}

function cardHtml(count = 6): string {
  const cards = Array.from({ length: count }, (_value, index) => `
    <article class="event-card">
      <h2>Recovery Hackathon ${index + 1}</h2>
      <p>Online</p>
      <time>Aug ${index + 1}, 2027</time>
      <p>Build useful things with public data.</p>
    </article>
  `).join("");
  return `<!doctype html><main><section>${cards}</section></main>`;
}

function providerSelectingFirstGroup() {
  return createFakeLlmProvider({
    handler(input) {
      const user = input.messages.findLast((message) => message.role === "user")?.content ?? "{}";
      const parsed = JSON.parse(user) as { candidateGroups: Array<{ groupId: string }> };
      return JSON.stringify({
        selectedGroupId: parsed.candidateGroups[0]?.groupId,
        classification: "event_records",
        fields: {
          title: "title-like visible card text",
          date: "date-like visible card text",
          location: "location-like visible card text",
        },
        confidence: 0.9,
      });
    },
  });
}

describe("phase 5.4 bounded AI and vision-assisted recovery", () => {
  it("rejects extra fields, executable code, and invented endpoints", () => {
    const input = {
      sourceUrl: "https://events.example",
      candidateGroups: [
        {
          groupId: "dom:1",
          kind: "dom" as const,
          recordCount: 5,
          confidence: 0.8,
          titleCoverage: 1,
          urlCoverage: 0,
          dateCoverage: 0.8,
          locationCoverage: 0.8,
          sampleRecords: [{ text: "Recovery Hackathon Aug 1, 2027 Online" }],
          validatorReasons: [],
        },
      ],
      actionCandidates: [],
    };
    assert.equal(validateAiPageDecision({ classification: "event_records", confidence: 0.8, extra: true }, input).ok, false);
    assert.equal(validateAiPageDecision({ classification: "event_records", selectedGroupId: "dom:1", fields: { title: "document.querySelector('x')" }, confidence: 0.8 }, input).ok, false);
    assert.equal(validateAiPageDecision({ classification: "event_records", selectedGroupId: "dom:1", fields: { url: "/api/private/events" }, confidence: 0.8 }, input).ok, false);
  });

  it("builds bounded sanitized AI input from candidate groups", () => {
    const input = buildAiPageDecisionInput({
      sourceUrl: "https://events.example/list?token=secret",
      artifacts: [artifact(cardHtml(12))],
      recordSets: [],
      schemas: new Map(),
      validations: [],
      repeatedUnitSets: [],
      actionCandidates: [],
    });
    assert.equal(input.sourceUrl, "https://events.example");
    assert.ok(input.candidateGroups.length <= 5);
    assert.ok(input.candidateGroups.every((group) => group.sampleRecords.length <= 10));
    assert.doesNotMatch(JSON.stringify(input), /cookie|authorization|secret/i);
  });

  it("recovers a repeated DOM group with composite identity after strict AI selection", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(cardHtml(6), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    try {
      const result = await runGenericStructuredExtraction(source(), {
        aiProvider: providerSelectingFirstGroup(),
      });
      assert.equal(result.aiAssistance?.invoked, true);
      assert.equal(result.aiAssistance?.accepted, true);
      assert.equal(result.strategySelected, "dom");
      assert.equal(result.leads.length, 6);
      assert.ok(result.leads.every((lead) => lead.sourceRecordId?.startsWith("composite:")));
      assert.ok(result.leads.every((lead) => !lead.canonicalUrl));
      assert.ok((result.quality.estimatedPrecision ?? 0) >= 0.9);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not invoke AI when deterministic structured extraction succeeds", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(`<!doctype html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: {
          pageProps: {
            events: Array.from({ length: 6 }, (_value, index) => ({
              title: `Deterministic Hackathon ${index}`,
              url: `/events/${index}`,
              starts_at: `2027-08-${String(index + 1).padStart(2, "0")}`,
              location: "Online",
              status: "open",
            })),
          },
        },
      })}</script>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    try {
      const result = await runGenericStructuredExtraction(source(), {
        aiProvider: providerSelectingFirstGroup(),
      });
      assert.ok(result.leads.length >= 6);
      assert.equal(result.aiAssistance?.invoked, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps Phase 5.4 generic and persistence-free", async () => {
    for (const file of [
      "src/experiments/scraper-v2/generic/aiPageDecision.ts",
      "src/experiments/scraper-v2/generic/structuredExtraction.ts",
      "src/experiments/scraper-v2/generic/domSchema.ts",
    ]) {
      const content = await readFile(file, "utf8");
      assert.doesNotMatch(content, /\b(?:dorahacks|hackathons\.space|eventornado|devpost|mlh|garage48|eventbrite|hackathonradar)\b/i);
      assert.doesNotMatch(content, /supabase|candidateRepository|persistCandidate|googleapis|Queue mutation|source health/i);
    }
  });
});
