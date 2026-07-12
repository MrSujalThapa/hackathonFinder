import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCandidateFingerprint,
  createSourceIdIdentity,
  createSourceUrlIdentity,
  fingerprintsMatch,
  normalizeDatePart,
  normalizeUrl,
  preferStrongerText,
  preferUrl,
  sourceAuthority,
} from "./dedupe";

describe("normalizeUrl", () => {
  it("strips trailing slashes and sorts query params", () => {
    const left = normalizeUrl("https://example.com/event/?b=2&a=1");
    const right = normalizeUrl("https://www.example.com/event?a=1&b=2");
    assert.equal(left, "https://example.com/event?a=1&b=2");
    assert.equal(left, right);
  });
});

describe("normalizeDatePart", () => {
  it("normalizes ISO timestamps to date part", () => {
    assert.equal(normalizeDatePart("2026-09-13T12:00:00Z"), "2026-09-13");
  });
});

describe("createCandidateFingerprint", () => {
  it("matches same event with same official URL", () => {
    const base = {
      name: "AI Hackathon",
      officialUrl: "https://hack.example.com/ai",
      city: "Toronto",
      startDate: "2026-09-13",
    };

    assert.ok(fingerprintsMatch(base, { ...base, source: "devpost" } as never));
  });

  it("matches URLs with trailing slash and query params", () => {
    const left = createCandidateFingerprint({
      name: "Different Name Should Not Matter",
      officialUrl: "https://hack.example.com/event/?utm=1",
      city: "Toronto",
      startDate: "2026-09-13",
    });

    const right = createCandidateFingerprint({
      name: "Another Name",
      officialUrl: "https://www.hack.example.com/event",
      city: "Montreal",
      startDate: "2026-10-01",
    });

    assert.equal(left, right);
  });

  it("matches same name/date/location from different sources without URLs", () => {
    const left = createCandidateFingerprint({
      name: "Waterloo AI Hackathon",
      city: "Waterloo",
      country: "Canada",
      mode: "in-person",
      startDate: "2026-08-01",
    });

    const right = createCandidateFingerprint({
      name: "waterloo ai hackathon",
      city: "Waterloo",
      country: "Canada",
      mode: "in-person",
      startDate: "2026-08-01",
      sourceIds: { hacklist: "card-99" },
    });

    assert.notEqual(left, right);

    const withoutSourceIds = createCandidateFingerprint({
      name: "waterloo ai hackathon",
      city: "Waterloo",
      country: "Canada",
      mode: "in-person",
      startDate: "2026-08-01",
    });

    assert.equal(left, withoutSourceIds);
  });

  it("does not collide when dates differ", () => {
    const left = createCandidateFingerprint({
      name: "City Hackathon",
      city: "Toronto",
      startDate: "2026-09-13",
    });

    const right = createCandidateFingerprint({
      name: "City Hackathon",
      city: "Toronto",
      startDate: "2026-10-13",
    });

    assert.notEqual(left, right);
  });

  it("does not collide when cities differ", () => {
    const left = createCandidateFingerprint({
      name: "City Hackathon",
      city: "Toronto",
      startDate: "2026-09-13",
    });

    const right = createCandidateFingerprint({
      name: "City Hackathon",
      city: "Montreal",
      startDate: "2026-09-13",
    });

    assert.notEqual(left, right);
  });

  it("uses stable fallback when URLs are missing", () => {
    const first = createCandidateFingerprint({
      name: "Mystery Hack",
      city: "Remote",
      mode: "online",
      deadline: "2026-08-20",
    });

    const second = createCandidateFingerprint({
      name: "Mystery Hack",
      city: "Remote",
      mode: "online",
      deadline: "2026-08-20T23:59:59Z",
    });

    assert.equal(first, second);
    assert.match(first, /^event:/);
  });
});

describe("createSourceUrlIdentity", () => {
  it("creates stable source URL identity", () => {
    const left = createSourceUrlIdentity("devpost", "https://devpost.com/hackathons/foo/");
    const right = createSourceUrlIdentity("devpost", "https://www.devpost.com/hackathons/foo");
    assert.equal(left, right);
    assert.equal(left, "source-url:devpost:https://devpost.com/hackathons/foo");
  });
});

describe("source authority preferences", () => {
  it("ranks official/MLH above X and web above X", () => {
    assert.ok(sourceAuthority("mlh") > sourceAuthority("x"));
    assert.ok(sourceAuthority("web") > sourceAuthority("x"));
    assert.ok(sourceAuthority("luma") > sourceAuthority("hacklist"));
  });

  it("lets X fill missing text but not overwrite stronger ISO dates", () => {
    assert.equal(
      preferStrongerText(undefined, "2026-08-20", "mlh", "x"),
      "2026-08-20",
    );
    assert.equal(
      preferStrongerText("2026-08-01", "2026-09-30", "mlh", "x"),
      "2026-08-01",
    );
    assert.equal(
      preferStrongerText("2026-09-30", "2026-08-01", "x", "mlh"),
      "2026-08-01",
    );
  });

  it("preferUrl keeps MLH official over weaker X-linked URL", () => {
    const kept = preferUrl(
      "https://events.mlh.io/events/1",
      "https://blog.example.com/post",
      "mlh",
      "x",
    );
    assert.equal(kept, "https://events.mlh.io/events/1");
  });

  it("createSourceIdIdentity sorts array x post ids stably", () => {
    const left = createSourceIdIdentity({ x: ["222", "111"], mlh: "1" });
    const right = createSourceIdIdentity({ x: ["111", "222"], mlh: "1" });
    assert.equal(left, right);
    assert.match(String(left), /x:111,222/);
  });
});
