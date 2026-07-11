import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parseLumaHtml } from "@/collectors/luma";

const fixturePath = path.join(process.cwd(), "src/collectors/__fixtures__/luma.html");

describe("parseLumaHtml", () => {
  it("accepts likely hackathons", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseLumaHtml(html, 20);
    assert.ok(leads.some((lead) => (lead.title ?? "").includes("Toronto AI Hackathon")));
    assert.ok(leads.some((lead) => (lead.title ?? "").includes("Remote Agent Buildathon")));
    assert.ok(leads.some((lead) => (lead.title ?? "").includes("Waterloo Student Codefest")));
  });

  it("excludes ordinary meetups", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseLumaHtml(html, 20);
    assert.ok(!leads.some((lead) => /coffee meetup/i.test(lead.title ?? "")));
  });

  it("parses online events", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseLumaHtml(html, 20);
    const remote = leads.find((lead) => (lead.title ?? "").includes("Remote Agent"));
    assert.ok(remote);
    assert.equal(remote!.metadata?.mode, "online");
    assert.equal(remote!.metadata?.location, "Online");
  });

  it("parses location and date", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseLumaHtml(html, 20);
    const toronto = leads.find((lead) => (lead.title ?? "").includes("Toronto AI Hackathon"));
    assert.ok(toronto);
    assert.match(String(toronto!.metadata?.location ?? ""), /Toronto/i);
    assert.equal(toronto!.metadata?.startDate, "2026-09-13");
  });

  it("preserves external official / apply links", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseLumaHtml(html, 20);
    const toronto = leads.find((lead) => (lead.title ?? "").includes("Toronto AI Hackathon"));
    assert.ok(toronto);
    assert.match(String(toronto!.metadata?.applyUrl ?? ""), /hackto\.example\.com/i);
    assert.ok(toronto!.links.some((link) => /hackto\.example\.com/i.test(link)));
  });

  it("removes duplicate event URLs", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseLumaHtml(html, 20);
    const toronto = leads.filter((lead) => /toronto-ai-hackathon-2026/i.test(lead.url ?? ""));
    assert.equal(toronto.length, 1);
  });

  it("handles incomplete events safely", () => {
    const html = `<!DOCTYPE html><html><body>
      <article class="event-card">
        <a href="https://lu.ma/minimal-hackathon"><h1>Minimal Hackathon</h1></a>
      </article>
      <article class="event-card"><p>No title</p></article>
    </body></html>`;
    const leads = parseLumaHtml(html, 5);
    assert.equal(leads.length, 1);
    assert.equal(leads[0]?.title, "Minimal Hackathon");
  });
});
