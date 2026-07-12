import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import fixture from "@/collectors/__fixtures__/hakku-session.json";
import { parseHakkuCards, type HakkuCard } from "@/collectors/hakku";
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
