import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parseDevpostHtml } from "@/collectors/devpost";

const fixturePath = path.join(
  process.cwd(),
  "src/collectors/__fixtures__/devpost.html",
);

describe("parseDevpostHtml", () => {
  it("extracts hackathon cards from fixture HTML", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseDevpostHtml(html, 10);
    assert.ok(leads.length >= 2);
    assert.ok(leads.some((lead) => /AI Agent Summit/i.test(lead.title ?? "")));
  });

  it("captures listing URLs and metadata", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseDevpostHtml(html, 10);
    const toronto = leads.find((lead) => /Toronto Builder/i.test(lead.title ?? ""));
    assert.ok(toronto);
    assert.match(toronto!.url ?? "", /devpost\.com/);
    assert.equal(toronto!.metadata?.location, "Toronto, Canada");
  });

  it("dedupes duplicate listing URLs", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseDevpostHtml(html, 10);
    const toronto = leads.filter((lead) => /Toronto Builder/i.test(lead.title ?? ""));
    assert.equal(toronto.length, 1);
  });
});
