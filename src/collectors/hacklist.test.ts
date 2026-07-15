import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  countHacklistCards,
  describeHacklistFailure,
  parseHacklistHtml,
} from "@/collectors/hacklist";

const fixturePath = path.join(
  process.cwd(),
  "src/collectors/__fixtures__/hacklist.html",
);

describe("parseHacklistHtml", () => {
  it("extracts multiple cards from fixture HTML", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseHacklistHtml(html, 10);
    assert.ok(leads.length >= 3);
    assert.ok(leads.some((lead) => (lead.title ?? "").includes("SKALE")));
  });

  it("extracts apply and official links with hacklist provenance", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseHacklistHtml(html, 10);
    const skale = leads.find((lead) => (lead.title ?? "").includes("SKALE"));
    assert.ok(skale);
    assert.ok(skale!.links.some((link) => /dorahacks/i.test(link)));
    assert.ok(skale!.metadata?.applyUrl || skale!.metadata?.officialUrl);
    assert.equal(skale!.metadata?.attribution, "hacklist");
    assert.equal(skale!.source, "hacklist");
    assert.ok(!/hacklist-omega\.vercel\.app/i.test(skale!.url ?? ""));
  });

  it("extracts prize from featured span/aria markup", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseHacklistHtml(html, 10);
    const gemini = leads.find((lead) => (lead.title ?? "").includes("Gemini"));
    assert.ok(gemini);
    assert.match(String(gemini!.metadata?.prize ?? ""), /2,000,000|\$2/);
  });

  it("handles missing optional fields without crashing when apply URL exists", () => {
    const html = `<!DOCTYPE html><html><body><article aria-label="Minimal Hackathon, TBD. View details."><h3>Minimal Hackathon</h3><a href="https://example.com/apply">Apply</a></article></body></html>`;
    const leads = parseHacklistHtml(html, 5);
    assert.equal(leads.length, 1);
    assert.equal(leads[0]?.title, "Minimal Hackathon");
    assert.equal(leads[0]?.url, "https://example.com/apply");
  });

  it("skips directory-only cards without external apply URLs", () => {
    const html = `<!DOCTYPE html><html><body><article aria-label="Directory Only, TBD. View details."><h3>Directory Only</h3></article></body></html>`;
    const leads = parseHacklistHtml(html, 5);
    assert.equal(leads.length, 0);
  });

  it("dedupes duplicate links and cards", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const duplicate = html.replace(
      "SKALE Programmable Privacy Hackathon",
      "SKALE Programmable Privacy Hackathon Copy",
    );
    const leads = parseHacklistHtml(duplicate, 20);
    const skaleLinks = leads.filter((lead) => /skale/i.test(lead.title ?? ""));
    assert.equal(skaleLinks.length, 1);
  });

  it("counts cards for diagnostics", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    assert.ok(countHacklistCards(html) >= 3);
  });

  it("formats failure categories for health classification", () => {
    assert.match(
      describeHacklistFailure("selector_parser_failure"),
      /selector\/parser failure/i,
    );
    assert.match(describeHacklistFailure("network", "fetch failed"), /network/i);
  });
});
