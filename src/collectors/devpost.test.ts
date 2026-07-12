import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildDevpostSearchUrls,
  canonicalizeDevpostUrl,
  describeDevpostFailure,
  isDevpostHackathonUrl,
  isRejectedDevpostUrl,
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
  });

  it("dedupes duplicate listing URLs", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseDevpostHtml(html, 10);
    const toronto = leads.filter((lead) => /Toronto Builder/i.test(lead.title ?? ""));
    assert.equal(toronto.length, 1);
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

  it("builds Canada/Toronto/remote/AI/upcoming search URLs", () => {
    const prefs = getDefaultDiscoveryPreferences("find AI hackathons in Canada Toronto remote");
    prefs.themes = ["AI"];
    prefs.locations = ["Canada", "Toronto"];
    prefs.includeRemote = true;
    const urls = buildDevpostSearchUrls(prefs);
    assert.ok(urls.length >= 3);
    assert.ok(urls.every((url) => /status(%5B%5D|\[\])=upcoming/.test(url)));
    assert.ok(urls.some((url) => /search=AI/i.test(url)));
    assert.ok(urls.some((url) => /search=Toronto/i.test(url)));
    assert.ok(urls.some((url) => /search=Canada/i.test(url)));
    assert.ok(urls.some((url) => /search=remote/i.test(url)));
  });

  it("formats failure categories for health classification", () => {
    assert.match(describeDevpostFailure("browser_missing"), /Playwright/i);
    assert.match(describeDevpostFailure("selector_parser_failure"), /selector\/parser/i);
  });
});
