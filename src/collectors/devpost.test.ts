import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildDevpostApiUrl,
  buildDevpostListingsUrl,
  buildDevpostSearchUrls,
  canonicalizeDevpostUrl,
  DEVPOST_OPEN_UPCOMING_URL,
  describeDevpostFailure,
  devpostFingerprint,
  isDevpostHackathonUrl,
  isRejectedDevpostUrl,
  parseDevpostApiPayload,
  parseDevpostHtml,
} from "@/collectors/devpost";
import { getDefaultDiscoveryPreferences } from "@/agent/parseCommand";

const fixturePath = path.join(
  process.cwd(),
  "src/collectors/__fixtures__/devpost.html",
);

describe("parseDevpostHtml", () => {
  it("extracts hackathon cards from tile-anchor fixture HTML", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseDevpostHtml(html, 10);
    assert.ok(leads.length >= 2);
    assert.ok(leads.some((lead) => /AI Agent Summit/i.test(lead.title ?? "")));
  });

  it("captures listing URLs, metadata, and canonical URLs", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseDevpostHtml(html, 10);
    const toronto = leads.find((lead) => /Toronto Builder/i.test(lead.title ?? ""));
    assert.ok(toronto);
    assert.match(toronto!.url ?? "", /toronto-builder\.devpost\.com/i);
    assert.ok(!/\?/.test(toronto!.url ?? ""));
    assert.equal(toronto!.metadata?.location, "Toronto, Canada");
    assert.match(String(toronto!.metadata?.prize ?? ""), /10,000/);
    assert.equal(toronto!.metadata?.attribution, "devpost");
    assert.equal(toronto!.metadata?.provenance, "native_devpost");
    assert.equal(toronto!.metadata?.discoveryMode, "native_devpost");
  });

  it("dedupes duplicate listing URLs", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseDevpostHtml(html, 10);
    const toronto = leads.filter((lead) => /Toronto Builder/i.test(lead.title ?? ""));
    assert.equal(toronto.length, 1);
  });

  it("parses lazy-loaded appended cards and removes duplicate URLs", () => {
    const html = `${fs.readFileSync(fixturePath, "utf8")}
      <a class="flex-row tile-anchor" href="https://lazy-loaded.devpost.com/?ref_feature=challenge">
        <div class="content">
          <h3>Lazy Loaded Hackathon</h3>
          <div class="status-label open">20 days left</div>
          <div class="info"><span>Online</span></div>
          <div><span class="prize-amount">$5,000</span> in prizes</div>
          <div>Sep 10 - Oct 1, 2026</div>
        </div>
      </a>`;
    const leads = parseDevpostHtml(html, 20);
    assert.ok(leads.some((lead) => /Lazy Loaded Hackathon/i.test(lead.title ?? "")));
    assert.equal(
      leads.filter((lead) => /toronto-builder\.devpost\.com/i.test(lead.url ?? "")).length,
      1,
    );
  });

  it("rejects ended, portfolio, project, and generic pages", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseDevpostHtml(html, 20);
    assert.ok(!leads.some((lead) => /Ended Archive/i.test(lead.title ?? "")));
    assert.ok(!leads.some((lead) => /Portfolio Project/i.test(lead.title ?? "")));
    assert.ok(!leads.some((lead) => /User Portfolio/i.test(lead.title ?? "")));
    assert.ok(!leads.some((lead) => /Generic Listing/i.test(lead.title ?? "")));
  });
});

describe("devpost url helpers", () => {
  it("canonicalizes tracking query params", () => {
    assert.equal(
      canonicalizeDevpostUrl(
        "https://openai.devpost.com/?ref_feature=challenge&ref_medium=discover",
      ),
      "https://openai.devpost.com/",
    );
  });

  it("rejects non-hackathon Devpost URLs", () => {
    assert.equal(isRejectedDevpostUrl("https://devpost.com/software/foo"), true);
    assert.equal(isRejectedDevpostUrl("https://devpost.com/hackathons"), true);
    assert.equal(isRejectedDevpostUrl("https://devpost.com/jane-doe"), true);
    assert.equal(isDevpostHackathonUrl("https://openai.devpost.com/"), true);
    assert.equal(isDevpostHackathonUrl("https://devpost.com/software/foo"), false);
  });

  it("uses the exact filtered open/upcoming discovery URL", () => {
    const prefs = getDefaultDiscoveryPreferences("find AI hackathons in Canada Toronto remote");
    const urls = buildDevpostSearchUrls(prefs);
    assert.deepEqual(urls, [DEVPOST_OPEN_UPCOMING_URL]);
    assert.equal(urls[0], "https://devpost.com/hackathons?status[]=upcoming&status[]=open&page=1");
  });

  it("builds numbered pages without dropping open/upcoming filters", () => {
    assert.equal(
      buildDevpostListingsUrl(7),
      "https://devpost.com/hackathons?status[]=upcoming&status[]=open&page=7",
    );
  });

  it("builds the observed read-only API pagination URL", () => {
    assert.equal(
      buildDevpostApiUrl(2),
      "https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&page=2",
    );
  });

  it("detects repeated manual page fingerprints", () => {
    const pageOne = devpostFingerprint([
      "https://xprize.devpost.com/?ref=discover",
      "https://openai.devpost.com/",
    ]);
    const repeatedPageTwo = devpostFingerprint([
      "https://openai.devpost.com/",
      "https://xprize.devpost.com/",
    ]);
    assert.equal(repeatedPageTwo, pageOne);
  });

  it("parses native API payloads with Devpost provenance", () => {
    const leads = parseDevpostApiPayload(
      {
        hackathons: [
          {
            id: 28039,
            title: "Build with DataHub: The Agent Hackathon",
            url: "https://datahub.devpost.com/?ref_feature=challenge",
            displayed_location: { location: "Online" },
            open_state: "open",
            time_left_to_submission: "28 days left",
            submission_period_dates: "Jul 06 - Aug 10, 2026",
            themes: [{ name: "Machine Learning/AI" }],
            prize_amount: "$<span data-currency-value>20,500</span>",
            organization_name: "DataHub",
            start_a_submission_url: "https://datahub.devpost.com/challenges/start_a_submission",
          },
        ],
        meta: { total_count: 156, per_page: 9 },
      },
      10,
    );
    assert.equal(leads.length, 1);
    assert.equal(leads[0]!.url, "https://datahub.devpost.com/");
    assert.equal(leads[0]!.metadata?.provenance, "native_devpost");
    assert.equal(leads[0]!.metadata?.discoveryMode, "native_devpost");
    assert.match(String(leads[0]!.metadata?.prize), /20,500/);
  });

  it("formats failure categories for health classification", () => {
    assert.match(describeDevpostFailure("browser_missing"), /Playwright/i);
    assert.match(describeDevpostFailure("selector_parser_failure"), /selector\/parser/i);
    assert.match(describeDevpostFailure("listing_container_missing"), /container missing/i);
  });
});
