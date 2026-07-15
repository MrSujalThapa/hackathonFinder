import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parseDevpostHtml } from "@/collectors/devpost";
import { parseHacklistHtml } from "@/collectors/hacklist";
import { extractHackathonEvent } from "@/core/extract";

describe("extractHackathonEvent real leads", () => {
  it("extracts mode, dates, and themes from HackList-style leads", () => {
    const html = fs.readFileSync(
      path.join(process.cwd(), "src/collectors/__fixtures__/hacklist.html"),
      "utf8",
    );
    const [lead] = parseHacklistHtml(html, 1);
    assert.ok(lead);

    const event = extractHackathonEvent(lead);
    assert.ok(event);
    assert.ok(event!.officialUrl);
    assert.ok(event!.themes.length >= 0);
    assert.ok(event!.evidence.some((item) => item.url));
  });

  it("extracts Toronto location and in-person mode from Devpost-style leads", () => {
    const html = fs.readFileSync(
      path.join(process.cwd(), "src/collectors/__fixtures__/devpost.html"),
      "utf8",
    );
    const leads = parseDevpostHtml(html, 5);
    const toronto = leads.find((lead) => /Toronto/i.test(lead.title ?? ""));
    assert.ok(toronto);

    const event = extractHackathonEvent(toronto);
    assert.ok(event);
    assert.equal(event!.city, "Toronto");
    assert.equal(event!.country, "Canada");
    assert.ok(event!.location);
    assert.equal(event!.eventLocation?.mode, "in_person");
  });

  it("derives registration deadline from days-left text", () => {
    const event = extractHackathonEvent({
      id: "hacklist-deadline",
      source: "hacklist",
      title: "Deadline Hack",
      url: "https://example.com/hack",
      text: "Registration closes soon - 5 days left",
      links: ["https://example.com/hack"],
      postedAt: new Date().toISOString(),
      metadata: {},
    });

    assert.ok(event?.registrationDeadline);
    assert.equal(event?.deadline, event?.registrationDeadline);
  });
});
