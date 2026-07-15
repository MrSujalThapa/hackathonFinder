import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { enumerateCandidateActionsFromHtml, verifyActionStateProgression } from "@/experiments/scraper-v2/generic/browserActions";
import {
  buildVisionPageDecisionInput,
  shouldInvokeVisionPageDecision,
  validateVisionPageDecision,
} from "@/experiments/scraper-v2/generic/visionPageDecision";
import { createOpenAiLlmProvider } from "@/lib/llm/providers/openai";
import type { AcquiredArtifact, DomExtractionResult, RepeatedUnitSet } from "@/experiments/scraper-v2/generic/types";

function unitSet(overrides: Partial<RepeatedUnitSet> = {}): RepeatedUnitSet {
  return {
    unitSetId: "dom_snapshot:0:10:1",
    artifactId: "dom_snapshot:0",
    parentNodeId: 10,
    unitNodeIds: [11, 12, 13],
    structuralScore: 0.8,
    fieldDensityScore: 0.7,
    layoutScore: 0.6,
    confidence: 0.75,
    rejectionReasons: [],
    diagnostics: {
      unitCount: 3,
      averageTextLength: 80,
      uniqueTitleRatio: 1,
      uniqueUrlRatio: 0,
      dateCoverage: 0,
      locationCoverage: 0,
      anchorCoverage: 0,
      depth: 3,
    },
    ...overrides,
  };
}

function domResult(set = unitSet()): DomExtractionResult {
  return {
    strategy: "dom",
    representations: [{ artifactId: "dom_snapshot:0", nodeCount: 20, maxDepth: 4 }],
    repeatedUnitSets: [set],
    selectedUnitSet: set,
    leads: [],
    availableRecords: set.diagnostics.unitCount,
    stopReason: "schema_rejected",
    timings: {},
  };
}

function screenshotArtifact(): AcquiredArtifact {
  return {
    artifactId: "dom_snapshot:0",
    kind: "dom_snapshot",
    sourceUrl: "https://events.example/list",
    acquisitionMode: "browser",
    byteSize: 1000,
    timingMs: 1,
    payload: {
      html: "<main><article>Visual Hackathon</article></main>",
      screenshotBase64: Buffer.from("png").toString("base64"),
      screenshotMediaType: "image/png",
      visualNodes: [
        { nodeId: 11, text: "Visual Hackathon", boundingBox: { x: 10, y: 20, width: 200, height: 80 } },
        { nodeId: 12, text: "Prize challenge", boundingBox: { x: 10, y: 110, width: 200, height: 80 } },
        { nodeId: 13, text: "Apply now", boundingBox: { x: 10, y: 200, width: 200, height: 80 } },
      ],
    },
  };
}

describe("phase 5.5 acquisition vision and action recovery", () => {
  it("builds bounded vision input from screenshot and DOM boxes", () => {
    const input = buildVisionPageDecisionInput({
      sourceUrl: "https://events.example/list?secret=1",
      artifacts: [screenshotArtifact()],
      dom: domResult(),
      actionCandidates: enumerateCandidateActionsFromHtml("<button>Load more</button>", "https://events.example/list"),
    });
    assert.ok(input);
    assert.equal(input.sourceOrigin, "https://events.example");
    assert.ok(input.candidateGroups.length <= 5);
    assert.ok(input.candidateGroups[0]?.boundingBoxes.length);
    assert.doesNotMatch(JSON.stringify({ ...input, screenshotBase64: "" }), /secret/i);
  });

  it("rejects invented vision nodes, groups, actions, URLs, selectors, and low confidence", () => {
    const input = buildVisionPageDecisionInput({
      sourceUrl: "https://events.example/list",
      artifacts: [screenshotArtifact()],
      dom: domResult(),
      actionCandidates: [{ elementId: "action:1", accessibleName: "More", proposedEffect: "load_more", confidence: 0.8, disabled: false, context: "pagination" }],
    });
    assert.ok(input);
    assert.equal(validateVisionPageDecision({ value: { selectedGroupIds: ["invented"], confidence: 0.9 }, sanitizedInput: input, unitSets: [unitSet()] }).ok, false);
    assert.equal(validateVisionPageDecision({ value: { selectedActionId: "action:99", confidence: 0.9 }, sanitizedInput: input, unitSets: [unitSet()] }).ok, false);
    assert.equal(validateVisionPageDecision({ value: { selectedGroupIds: ["dom_snapshot:0:10:1"], fieldRegions: { title: "document.querySelector('.card')" }, confidence: 0.9 }, sanitizedInput: input, unitSets: [unitSet()] }).ok, false);
    assert.equal(validateVisionPageDecision({ value: { selectedGroupIds: ["dom_snapshot:0:10:1"], confidence: 0.2 }, sanitizedInput: input, unitSets: [unitSet()] }).ok, false);
  });

  it("gates text AI and vision mutually for unresolved page shapes", () => {
    const input = buildVisionPageDecisionInput({
      sourceUrl: "https://events.example/list",
      artifacts: [screenshotArtifact()],
      dom: domResult(),
      actionCandidates: [],
    });
    assert.equal(shouldInvokeVisionPageDecision({ deterministicValidEvents: 0, textAiAccepted: false, visionInput: input }), true);
    assert.equal(shouldInvokeVisionPageDecision({ deterministicValidEvents: 1, textAiAccepted: false, visionInput: input }), false);
    assert.equal(shouldInvokeVisionPageDecision({ deterministicValidEvents: 0, textAiAccepted: true, visionInput: input }), false);
  });

  it("maps image-capable OpenAI requests into the Responses input shape", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = createOpenAiLlmProvider({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchImpl: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ id: "resp", model: "gpt-4o-mini", output_text: "{\"confidence\":0.1}", status: "completed" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    await provider.generate({
      messages: [{ role: "user", content: [{ type: "text", text: "group" }, { type: "image", mediaType: "image/png", imageBase64: "abc", detail: "low" }] }],
      responseFormat: { type: "json_object" },
    });
    const input = body?.input as Array<{ content: Array<{ type: string; image_url?: string }> }>;
    assert.equal(input[0]?.content[0]?.type, "input_text");
    assert.equal(input[0]?.content[1]?.type, "input_image");
    assert.equal(input[0]?.content[1]?.image_url, "data:image/png;base64,abc");
  });

  it("verifies two-action progression and rejects repeated same-fingerprint actions", () => {
    const attempted = new Map<string, string>();
    const seen = new Set(["a"]);
    const first = verifyActionStateProgression({
      actionId: "synthetic:scroll",
      beforeFingerprint: "p1",
      afterFingerprint: "p2",
      seenIdentityKeys: seen,
      nextIdentityKeys: new Set(["a", "b"]),
      attemptedFingerprintByAction: attempted,
    });
    assert.equal(first.accepted, true);
    attempted.set("synthetic:scroll", "p1");
    first.newIdentityKeys.forEach((key) => seen.add(key));
    const second = verifyActionStateProgression({
      actionId: "synthetic:scroll",
      beforeFingerprint: "p2",
      afterFingerprint: "p3",
      seenIdentityKeys: seen,
      nextIdentityKeys: new Set(["a", "b", "c"]),
      attemptedFingerprintByAction: attempted,
    });
    assert.equal(second.accepted, true);
    attempted.set("synthetic:scroll", "p2");
    const repeated = verifyActionStateProgression({
      actionId: "synthetic:scroll",
      beforeFingerprint: "p2",
      afterFingerprint: "p3",
      seenIdentityKeys: seen,
      nextIdentityKeys: new Set(["a", "b", "c"]),
      attemptedFingerprintByAction: attempted,
    });
    assert.equal(repeated.accepted, false);
  });

  it("keeps Phase 5.5 generic and persistence-free", async () => {
    for (const file of [
      "src/experiments/scraper-v2/generic/acquisition.ts",
      "src/experiments/scraper-v2/generic/browserActions.ts",
      "src/experiments/scraper-v2/generic/visionPageDecision.ts",
      "src/experiments/scraper-v2/generic/structuredExtraction.ts",
    ]) {
      const content = await readFile(file, "utf8");
      assert.doesNotMatch(content, /\b(?:dorahacks|hackathons\.space|eventornado|devpost|mlh|garage48|eventbrite|hackathonradar)\b/i);
      assert.doesNotMatch(content, /supabase|candidateRepository|persistCandidate|googleapis|Queue mutation|source health/i);
    }
  });
});
