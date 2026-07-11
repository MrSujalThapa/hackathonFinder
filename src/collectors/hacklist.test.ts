import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parseHacklistHtml } from "@/collectors/hacklist";

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

  it("extracts apply and official links", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseHacklistHtml(html, 10);
    const skale = leads.find((lead) => (lead.title ?? "").includes("SKALE"));
    assert.ok(skale);
    assert.ok(skale!.links.some((link) => /dorahacks/i.test(link)));
    assert.ok(skale!.metadata?.applyUrl || skale!.metadata?.officialUrl);
  });

  it("handles missing optional fields without crashing", () => {
    const html = `<!DOCTYPE html><html><body><article aria-label="Minimal Hackathon, TBD. View details."><h3>Minimal Hackathon</h3></article></body></html>`;
    const leads = parseHacklistHtml(html, 5);
    assert.equal(leads.length, 1);
    assert.equal(leads[0]?.title, "Minimal Hackathon");
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
});
