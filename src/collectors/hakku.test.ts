import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import fixture from "@/collectors/__fixtures__/hakku-session.json";
import {
  HAKKU_EXPLORE_URL,
  extractHakkuCardsFromHtml,
  extractHakkuDetailFromHtml,
  mergeHakkuDetail,
  parseHakkuCards,
  type HakkuCard,
} from "@/collectors/hakku";
import {
  detectHakkuAuth,
  filterUpcomingHakkuCards,
} from "@/lib/browser/hakkuAuth";
import {
  DEFAULT_BROWSER_PROFILE_ROOT,
  DEFAULT_HAKKU_PROFILE_NAME,
  redactProfilePaths,
  resolveBrowserProfileRoot,
  resolveHakkuProfileDir,
  resolveHakkuProfileName,
} from "@/lib/browser/profilePaths";
import { writeHakkuSessionMeta } from "@/lib/browser/sessionMeta";

const fixturesDir = path.join(process.cwd(), "src", "collectors", "__fixtures__");

describe("parseHakkuCards", () => {
  it("uses the Hakku explore directory as the discovery URL", () => {
    assert.equal(HAKKU_EXPLORE_URL, "https://www.hakku.app/explore");
  });

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

  it("preserves native Hakku provenance and external official URLs", () => {
    const leads = parseHakkuCards(
      [
        {
          title: "Hack the 6ix",
          url: "https://hackthe6ix.carrd.co/",
          externalEventUrl: "https://hackthe6ix.carrd.co/",
          hakkuDetailUrl: "https://www.hakku.app/events/hack-the-6ix",
          dateText: "Jul 17-19",
          location: "Toronto, Ontario, Canada",
          format: "IN-PERSON",
          text: "An in-person hackathon event in Toronto.",
          links: ["https://hackthe6ix.carrd.co/"],
          tags: ["IN-PERSON", "AI"],
        },
      ],
      5,
    );

    assert.equal(leads.length, 1);
    assert.equal(leads[0]?.source, "hakku");
    assert.equal(leads[0]?.metadata?.discoveryMode, "authenticated_hakku_explore");
    assert.equal(leads[0]?.metadata?.officialUrl, "https://hackthe6ix.carrd.co/");
    assert.equal(leads[0]?.metadata?.hakkuDetailUrl, "https://www.hakku.app/events/hack-the-6ix");
    assert.equal(leads[0]?.metadata?.mode, "in-person");
  });
});

describe("extractHakkuCardsFromHtml", () => {
  it("parses current non-anchor explore cards from rendered HTML", () => {
    const html = readFileSync(path.join(fixturesDir, "hakku-explore.html"), "utf8");
    const result = extractHakkuCardsFromHtml(html, 10);

    assert.equal(result.cards.length, 3);
    assert.equal(result.diagnostics.visitSiteButtons, 4);
    assert.equal(result.diagnostics.saveButtons, 4);
    assert.ok(result.diagnostics.candidateContainers >= 4);

    const toronto = result.cards.find((card) => card.title === "Hack the 6ix");
    assert.ok(toronto);
    assert.equal(toronto.location, "Toronto, Ontario, Canada");
    assert.equal(toronto.format, "IN-PERSON");
    assert.equal(toronto.dateText, "Jul 17-19");
    assert.equal(toronto.externalEventUrl, "https://hackthe6ix.carrd.co/");
    assert.equal(toronto.hakkuDetailUrl, "https://www.hakku.app/events/hack-the-6ix");
  });

  it("accepts Hakku cards that have Visit Site and date but no location", () => {
    const html = readFileSync(path.join(fixturesDir, "hakku-explore.html"), "utf8");
    const result = extractHakkuCardsFromHtml(html, 10);

    const devpostCard = result.cards.find((card) => card.title === "757 BLD WKND 2026 2.0");
    assert.ok(devpostCard);
    assert.equal(devpostCard.location, undefined);
    assert.equal(devpostCard.devpostUrl, "https://757-bld-wknd-2026-2-0.devpost.com/");
    assert.equal(devpostCard.externalEventUrl, "https://757-bld-wknd-2026-2-0.devpost.com/");
  });

  it("dedupes repeated Hakku cards by title and external URL", () => {
    const html = readFileSync(path.join(fixturesDir, "hakku-explore.html"), "utf8");
    const result = extractHakkuCardsFromHtml(html, 10);
    const garuda = result.cards.filter((card) => card.title === "Garuda Hacks 7.0");

    assert.equal(garuda.length, 1);
    assert.equal(garuda[0]?.location, "TBA");
  });

  it("reports visible controls separately from valid parsed cards", () => {
    const html = `
      <main>
        <div>
          <h3>Broken Event Card</h3>
          <p>Visible Hakku card controls rendered, but the event fields are incomplete.</p>
          <a>Visit Site</a>
          <button>Save</button>
        </div>
      </main>
    `;
    const result = extractHakkuCardsFromHtml(html, 10);

    assert.equal(result.diagnostics.candidateContainers, 1);
    assert.equal(result.cards.length, 0);
    assert.equal(result.diagnostics.validCards, 0);
  });
});

describe("extractHakkuDetailFromHtml", () => {
  it("extracts bounded detail fields when an internal Hakku detail page is available", () => {
    const html = readFileSync(path.join(fixturesDir, "hakku-detail.html"), "utf8");
    const detail = extractHakkuDetailFromHtml(html, "https://www.hakku.app/events/hack-the-6ix");

    assert.equal(detail.title, "Hack the 6ix");
    assert.equal(detail.organizer, "Hack the 6ix Team");
    assert.equal(detail.location, "Toronto, Ontario, Canada");
    assert.equal(detail.dateText, "Jul 17-19, 2026");
    assert.equal(detail.startDate, "2026-07-17");
    assert.equal(detail.endDate, "2026-07-19");
    assert.equal(detail.prizeSummary, "$10,000 in prizes");
    assert.equal(detail.contactEmail, "team@example.org");
    assert.equal(detail.externalEventUrl, "https://hackthe6ix.carrd.co/");
    assert.equal(detail.devpostUrl, "https://hack-the-6ix.devpost.com/");
    assert.ok(detail.tags?.includes("AI"));
  });

  it("merges detail fields without losing explore-card provenance", () => {
    const html = readFileSync(path.join(fixturesDir, "hakku-detail.html"), "utf8");
    const detail = extractHakkuDetailFromHtml(html, "https://www.hakku.app/events/hack-the-6ix");
    const merged = mergeHakkuDetail(
      {
        title: "Hack the 6ix",
        hakkuDetailUrl: "https://www.hakku.app/events/hack-the-6ix",
        links: ["https://www.hakku.app/events/hack-the-6ix"],
        tags: ["IN-PERSON"],
      },
      detail,
    );

    assert.equal(merged.hakkuDetailUrl, "https://www.hakku.app/events/hack-the-6ix");
    assert.equal(merged.externalEventUrl, "https://hackthe6ix.carrd.co/");
    assert.ok(merged.links.includes("https://www.hakku.app/events/hack-the-6ix"));
    assert.ok(merged.tags.includes("IN-PERSON"));
    assert.ok(merged.tags.includes("Security"));
  });
});

describe("detectHakkuAuth", () => {
  it("detects authenticated session from swipe signals", () => {
    assert.equal(detectHakkuAuth(fixture.sessionValid), "authenticated");
  });

  it("detects login redirect / credentials page", () => {
    assert.equal(detectHakkuAuth(fixture.loginRedirect), "login_required");
  });

  it("returns unknown when signals are inconclusive", () => {
    assert.equal(detectHakkuAuth(fixture.unknownFeed), "unknown");
  });
});

describe("filterUpcomingHakkuCards", () => {
  it("drops ended/past cards from fixture payloads", () => {
    const upcoming = filterUpcomingHakkuCards(fixture.cards as HakkuCard[]);
    assert.equal(upcoming.length, 1);
    assert.equal(upcoming[0]?.title, "Agent Commerce Hackathon");
  });
});

describe("hakku profile path resolution", () => {
  it("resolves default relative profile under .data/browser-profiles/hakku", () => {
    const cwd = path.resolve("/repo");
    const root = resolveBrowserProfileRoot({}, cwd);
    const dir = resolveHakkuProfileDir({}, cwd);
    assert.equal(resolveHakkuProfileName({}), DEFAULT_HAKKU_PROFILE_NAME);
    assert.equal(root, path.resolve(cwd, DEFAULT_BROWSER_PROFILE_ROOT));
    assert.equal(dir, path.join(root, DEFAULT_HAKKU_PROFILE_NAME));
  });

  it("resolves posix absolute BROWSER_PROFILE_ROOT for worker mounts", () => {
    const dir = resolveHakkuProfileDir(
      {
        BROWSER_PROFILE_ROOT: "/data/browser-profiles",
        HAKKU_PROFILE_NAME: "hakku",
      },
      "/app",
    );
    assert.equal(dir, path.resolve("/data/browser-profiles", "hakku"));
  });

  it("resolves windows-style absolute profile roots via path APIs", () => {
    const winRoot = "C:\\data\\browser-profiles";
    const dir = resolveHakkuProfileDir(
      {
        BROWSER_PROFILE_ROOT: winRoot,
        HAKKU_PROFILE_NAME: "hakku",
      },
      "C:\\Users\\owner\\project",
    );
    assert.equal(dir, path.resolve(winRoot, "hakku"));
    assert.match(dir, /hakku$/);
  });

  it("honors custom HAKKU_PROFILE_NAME", () => {
    const dir = resolveHakkuProfileDir(
      {
        BROWSER_PROFILE_ROOT: ".data/browser-profiles",
        HAKKU_PROFILE_NAME: "hakku-owner",
      },
      path.resolve("/repo"),
    );
    assert.equal(path.basename(dir), "hakku-owner");
  });
});

describe("profile path redaction", () => {
  it("redacts absolute profile directories from messages", () => {
    const profileDir = path.join("C:", "Users", "owner", ".data", "browser-profiles", "hakku");
    const message = `Failed to open ${profileDir} for writing`;
    const redacted = redactProfilePaths(message, profileDir);
    assert.equal(redacted.includes(profileDir), false);
    assert.match(redacted, /\[browser-profile\]/);
  });

  it("does not embed profile paths when writing session meta status labels", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "hakku-meta-"));
    try {
      const env = {
        BROWSER_PROFILE_ROOT: path.join(tmp, "profiles"),
        HAKKU_PROFILE_NAME: "hakku",
      };
      mkdirSync(path.join(tmp, "profiles"), { recursive: true });
      const meta = writeHakkuSessionMeta("connected", env, tmp);
      const serialized = JSON.stringify(meta);
      assert.equal(serialized.includes(tmp), false);
      assert.equal(meta.status, "connected");
      assert.ok(meta.lastVerifiedAt);

      // Simulate a log line that accidentally included a path and ensure redaction works.
      const accidental = `probe failed under ${resolveHakkuProfileDir(env, tmp)}`;
      const safe = redactProfilePaths(accidental, resolveHakkuProfileDir(env, tmp));
      assert.equal(safe.includes(tmp), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("auth_required collector contract (fixture-level)", () => {
  it("maps login redirect to auth_required stop reason semantics", () => {
    const auth = detectHakkuAuth(fixture.loginRedirect);
    assert.equal(auth, "login_required");
    // Zero leads must not be treated as success when auth is required.
    const leads = parseHakkuCards([], 5);
    assert.equal(leads.length, 0);
    assert.equal(auth === "login_required" && leads.length === 0, true);
  });
});
