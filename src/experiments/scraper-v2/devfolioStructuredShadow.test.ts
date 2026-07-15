import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { compareShadowResults } from "@/experiments/scraper-v2/compareShadowResults";
import { discoverRecordArrays } from "@/experiments/scraper-v2/discoverRecordArrays";
import { evaluateExtractionQuality } from "@/experiments/scraper-v2/evaluateExtractionQuality";
import { normalizeStructuredRecords, resolveDevfolioUrl } from "@/experiments/scraper-v2/normalizeStructuredRecords";
import { runDevfolioStructuredShadow } from "@/experiments/scraper-v2/devfolioStructuredShadow";
import type { StructuredArtifact } from "@/experiments/scraper-v2/types";

function artifact(payload: unknown): StructuredArtifact {
  return {
    kind: "next_data",
    label: "__NEXT_DATA__",
    sourceUrl: "https://devfolio.co/hackathons",
    payload,
    byteLength: JSON.stringify(payload).length,
  };
}

const fixtureRecords = [
  {
    id: "1",
    name: "Open Builder Hack",
    slug: "open-builder-hack",
    status: "open",
    startsAt: "2026-08-01",
    location: "Online",
    description: "Build useful software.",
  },
  {
    id: "2",
    name: "Upcoming Climate Hack",
    url: "/climate-hack",
    status: "upcoming",
    startsAt: "2026-09-01",
    location: "Toronto",
  },
  {
    id: "3",
    name: "Past Chain Hack",
    slug: "past-chain-hack",
    status: "past",
    startsAt: "2025-01-01",
  },
  {
    id: "4",
    name: "Organize a hackathon",
    url: "/organize",
    status: "open",
  },
];

describe("Devfolio structured shadow extraction", () => {
  it("discovers nested candidate arrays from Next-style page state", () => {
    const arrays = discoverRecordArrays([
      artifact({ props: { pageProps: { hackathons: { open: fixtureRecords } } } }),
    ]);

    assert.ok(arrays.length >= 1);
    assert.equal(arrays[0]?.path, "props.pageProps.hackathons.open");
    assert.ok((arrays[0]?.confidence ?? 0) > 0.5);
  });

  it("scores repeated object shapes and infers probable fields", () => {
    const [array] = discoverRecordArrays([artifact({ records: fixtureRecords })]);

    assert.equal(array?.recordCount, 4);
    assert.equal(array?.probableFields.title, "name");
    assert.equal(array?.probableFields.slug, "slug");
    assert.equal(array?.probableFields.status, "status");
  });

  it("retains open and upcoming records while excluding past, navigation, and organize records", () => {
    const [array] = discoverRecordArrays([artifact({ records: fixtureRecords })]);
    assert.ok(array);

    const leads = normalizeStructuredRecords(fixtureRecords, array!);

    assert.deepEqual(leads.map((lead) => lead.title), [
      "Open Builder Hack",
      "Upcoming Climate Hack",
    ]);
    assert.ok(leads.every((lead) => lead.sourceId === "custom:devfolio"));
  });

  it("resolves relative and slug URLs while rejecting listing routes", () => {
    const [array] = discoverRecordArrays([artifact({ records: fixtureRecords })]);
    assert.ok(array);

    assert.deepEqual(resolveDevfolioUrl({ url: "/climate-hack" }, array!).strategy, "relative");
    assert.deepEqual(resolveDevfolioUrl({ slug: "open-builder-hack" }, array!).strategy, "slug");
    assert.deepEqual(resolveDevfolioUrl({ url: "/hackathons/open" }, array!).strategy, "rejected_listing");
  });

  it("deduplicates by stable ID, URL, or title/date", () => {
    const records = [fixtureRecords[0], { ...fixtureRecords[0] }];
    const [array] = discoverRecordArrays([artifact({ records })]);
    assert.ok(array);

    const leads = normalizeStructuredRecords(records, array!);

    assert.equal(leads.length, 1);
  });

  it("retains optional-field-poor records when title and event identity are present", () => {
    const records = [
      { id: "5", name: "Minimal Hack", slug: "minimal-hack", status: "open" },
      { id: "6", name: "Tiny Build Hack", slug: "tiny-build-hack", status: "open" },
    ];
    const [array] = discoverRecordArrays([artifact({ records })]);
    assert.ok(array);

    const leads = normalizeStructuredRecords(records, array!);

    assert.equal(leads.length, 2);
    assert.equal(leads[0]?.title, "Minimal Hack");
  });

  it("bounds excessive recursion and rejects low-confidence arrays", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: { records: fixtureRecords } } } } } } } } };
    const lowConfidence = { nav: [{ label: "Open" }, { label: "Past" }, { label: "Upcoming" }] };

    assert.equal(discoverRecordArrays([artifact(deep)]).length, 0);
    assert.equal(discoverRecordArrays([artifact(lowConfidence)]).length, 0);
  });

  it("evaluates quality and flags non-events", () => {
    const quality = evaluateExtractionQuality({
      arrays: [],
      selectedArrays: [],
      leads: [
        {
          sourceId: "custom:devfolio",
          extractionLayer: "next_data",
          title: "Open",
          confidence: 0.9,
        },
      ],
      durationMs: 10,
      acquisitionMode: "static",
      requestsMade: 1,
    });

    assert.equal(quality.obviousNonEventCount, 1);
    assert.equal(quality.validIndividualEventCount, 0);
  });

  it("runs the V2 pipeline without changing V1 comparison input", async () => {
    const acquisition = {
      finalUrl: "https://devfolio.co/hackathons",
      htmlBytes: 100,
      artifacts: [artifact({ records: fixtureRecords })],
      requestsMade: 1,
      mode: "static" as const,
      durationMs: 1,
    };
    const v2 = await runDevfolioStructuredShadow(acquisition);
    const v1 = [
      {
        id: "v1-open",
        source: "custom:devfolio" as const,
        title: "Open",
        links: [],
        postedAt: "2026-07-14T00:00:00Z",
      },
    ];
    const comparison = compareShadowResults(v1, v2);

    assert.equal(v2.persistenceDisabled, true);
    assert.equal(comparison.v1NormalizedLeads, 1);
    assert.equal(comparison.v2NormalizedLeads, 2);
  });

  it("experiment modules do not import production persistence repositories", async () => {
    const files = [
      "src/experiments/scraper-v2/devfolioStructuredShadow.ts",
      "src/experiments/scraper-v2/normalizeStructuredRecords.ts",
      "src/experiments/devfolioStructuredShadow.ts",
    ];
    const contents = await Promise.all(files.map((file) => readFile(file, "utf8")));

    for (const content of contents) {
      assert.doesNotMatch(content, /upsertCandidateByFingerprint|addEvidence|candidates\/repository/);
    }
  });
});
