import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildDevpostApiUrl,
  buildDevpostDatesUrl,
  buildDevpostFullDirectoryApiUrl,
  buildDevpostListingsUrl,
  buildDevpostOpenUpcomingApiUrl,
  buildDevpostSearchUrls,
  canonicalizeDevpostUrl,
  classifyDevpostOpenState,
  DEVPOST_FULL_DIRECTORY_URL,
  DEVPOST_OPEN_UPCOMING_URL,
  describeDevpostFailure,
  devpostBudgetForProfile,
  devpostFingerprint,
  isDevpostHackathonUrl,
  isRejectedDevpostUrl,
  parseDevpostApiRequestScope,
  parseDevpostDisplayedDateRange,
  parseDevpostApiPayload,
  parseDevpostHtml,
  parseDevpostScheduleHtml,
} from "@/collectors/devpost";
import { getDefaultDiscoveryPreferences } from "@/agent/parseCommand";
import { extractHackathonEvent } from "@/core/extract";

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
    const lazy = leads.find((lead) => /Lazy Loaded Hackathon/i.test(lead.title ?? ""));
    assert.equal(lazy?.metadata?.displayedDateRange, "Sep 10 - Oct 1, 2026");
    assert.equal(lazy?.metadata?.applicationDeadline, undefined);
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

  it("builds full-directory API URLs by default and keeps open+upcoming as an explicit subset", () => {
    assert.equal(buildDevpostApiUrl(2), "https://devpost.com/api/hackathons?page=2");
    assert.equal(
      buildDevpostFullDirectoryApiUrl(3),
      "https://devpost.com/api/hackathons?page=3",
    );
    assert.equal(
      buildDevpostOpenUpcomingApiUrl(2),
      "https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&page=2",
    );
    assert.equal(
      buildDevpostApiUrl(2, "open_upcoming_api_subset"),
      "https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&page=2",
    );
    assert.equal(DEVPOST_FULL_DIRECTORY_URL, "https://devpost.com/hackathons");
    assert.equal(
      parseDevpostApiRequestScope(
        "https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&page=1",
      ),
      "open_upcoming_api_subset",
    );
    assert.equal(
      parseDevpostApiRequestScope("https://devpost.com/api/hackathons?page=4"),
      "full_directory_api",
    );
  });

  it("keeps ended API cards during collection and classifies open_state", () => {
    const leads = parseDevpostApiPayload(
      {
        hackathons: [
          {
            id: 1,
            title: "Ended Challenge",
            url: "https://ended-challenge.devpost.com/",
            open_state: "ended",
            submission_period_dates: "Jan 01 - Jan 02, 2024",
          },
          {
            id: 2,
            title: "Open Challenge",
            url: "https://open-challenge.devpost.com/",
            open_state: "open",
          },
        ],
        meta: { total_count: 13601, per_page: 9 },
      },
      10,
      { includeEnded: true },
    );
    assert.equal(leads.length, 2);
    assert.equal(classifyDevpostOpenState("ended"), "ended");
    assert.equal(leads.find((l) => /Ended/.test(l.title ?? ""))?.metadata?.openState, "ended");
    const openOnly = parseDevpostApiPayload(
      {
        hackathons: [
          {
            id: 1,
            title: "Ended Challenge",
            url: "https://ended-challenge.devpost.com/",
            open_state: "ended",
          },
        ],
      },
      10,
      { includeEnded: false },
    );
    assert.equal(openOnly.length, 0);
  });

  it("does not treat a 166 open+upcoming total as a fixed collector cap", () => {
    const deep = devpostBudgetForProfile("deep", 50);
    assert.ok(deep.maxCards >= 300);
    assert.equal(deep.targetCards, 300);
    assert.equal(deep.stopAtTarget, false);
    assert.ok(deep.maxPages * 9 >= 300);
  });

  it("applies product profile targets: light 50–100, standard 150–250, deep ≥300", () => {
    const light = devpostBudgetForProfile("light", 200);
    const standard = devpostBudgetForProfile("standard", 50);
    const deep = devpostBudgetForProfile("deep", 50);
    const exhaustive = devpostBudgetForProfile("exhaustive", 50);

    assert.ok(light.targetCards >= 50 && light.targetCards <= 100);
    assert.ok(light.maxCards >= 50 && light.maxCards <= 100);
    assert.equal(light.stopAtTarget, true);
    assert.ok(light.detailLimit <= 12);

    assert.ok(standard.targetCards >= 150 && standard.targetCards <= 250);
    assert.ok(standard.maxCards >= 150 && standard.maxCards <= 250);
    assert.equal(standard.stopAtTarget, true);

    assert.equal(deep.targetCards, 300);
    assert.ok(deep.maxCards >= 300);
    assert.equal(deep.stopAtTarget, false);

    assert.ok(exhaustive.maxCards > deep.maxCards);
    assert.ok(exhaustive.targetCards > deep.targetCards);
    assert.equal(exhaustive.stopAtTarget, false);

    assert.ok(deep.maxCards > light.maxCards);
    assert.ok(deep.targetCards > light.targetCards);
  });

  it("builds canonical details/dates URLs only for challenge pages", () => {
    assert.equal(
      buildDevpostDatesUrl("https://datahub.devpost.com/?ref_feature=challenge"),
      "https://datahub.devpost.com/details/dates",
    );
    assert.equal(buildDevpostDatesUrl("https://devpost.com/hackathons"), undefined);
  });

  it("parses visible Devpost ranges without treating them as application deadlines", () => {
    assert.deepEqual(
      parseDevpostDisplayedDateRange("May 19 - Aug 17, 2026"),
      {
        displayedDateRange: "May 19 - Aug 17, 2026",
        startDate: "2026-05-19",
        endDate: "2026-08-17",
      },
    );
  });

  it("maps Devpost details/dates schedule fields to explicit normalized date fields", () => {
    const schedule = parseDevpostScheduleHtml(
      `
      <section><h3>Submissions</h3><p>Begins: July 13, 2026 at 9:00am PDT</p><p>Ends: July 21, 2026 at 5:00pm PDT</p></section>
      <section><h3>Judging</h3><p>Begins: July 22, 2026</p><p>Ends: July 25, 2026</p></section>
      <section><h3>Winners Announced</h3><p>Announced: July 30, 2026</p></section>
      `,
      "https://datahub.devpost.com/details/dates",
    );
    assert.equal(schedule.submissionOpenDate, "2026-07-13");
    assert.equal(schedule.submissionDeadline, "2026-07-21");
    assert.equal(schedule.judgingStartDate, "2026-07-22");
    assert.equal(schedule.judgingEndDate, "2026-07-25");
    assert.equal(schedule.resultAnnouncementDate, "2026-07-30");
    assert.ok(schedule.parsedDateEvidence.some((item) => item.kind === "submission_open"));
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
    assert.equal(leads[0]!.metadata?.displayedDateRange, "Jul 06 - Aug 10, 2026");
    assert.equal(leads[0]!.metadata?.submissionOpenDate, "2026-07-06");
    assert.equal(leads[0]!.metadata?.submissionDeadline, "2026-08-10");
    assert.equal(leads[0]!.metadata?.applicationDeadline, undefined);
    const event = extractHackathonEvent(leads[0]!);
    assert.equal(event?.displayedDateRange, "Jul 06 - Aug 10, 2026");
    assert.equal(event?.submissionDeadline, "2026-08-10");
    assert.equal(event?.applicationDeadline, undefined);
  });

  it("uses materially deeper Devpost budgets for deep and exhaustive profiles", () => {
    assert.ok(devpostBudgetForProfile("deep", 50).maxCards > 100);
    assert.ok(devpostBudgetForProfile("deep", 50).maxCards > devpostBudgetForProfile("light", 50).maxCards);
    assert.ok(devpostBudgetForProfile("exhaustive", 50).maxPages > devpostBudgetForProfile("deep", 50).maxPages);
  });

  it("formats failure categories for health classification", () => {
    assert.match(describeDevpostFailure("browser_missing"), /Playwright/i);
    assert.match(describeDevpostFailure("selector_parser_failure"), /selector\/parser/i);
    assert.match(describeDevpostFailure("listing_container_missing"), /container missing/i);
  });
});
