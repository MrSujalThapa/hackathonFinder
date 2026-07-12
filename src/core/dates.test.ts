import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isDeadlineClosed,
  isEventEnded,
  isStaleTitleYear,
  parseDatesFromText,
  todayIso,
} from "@/core/dates";

const NOW = new Date("2026-07-11T15:00:00Z");

describe("date correctness", () => {
  it("treats yesterday as closed and today as open", () => {
    assert.equal(isDeadlineClosed("2026-07-10", NOW), true);
    assert.equal(isDeadlineClosed("2026-07-11", NOW), false);
    assert.equal(todayIso(NOW), "2026-07-11");
  });

  it("rejects ended events even if start was earlier", () => {
    assert.equal(
      isEventEnded({ startDate: "2026-07-01", endDate: "2026-07-10" }, NOW),
      true,
    );
    assert.equal(
      isEventEnded({ startDate: "2026-08-01", endDate: "2026-08-03" }, NOW),
      false,
    );
  });

  it("detects stale title years without a verified current edition", () => {
    assert.equal(
      isStaleTitleYear("AI Agents Hackathon 2025", { startDate: "2025-05-01" }, NOW),
      true,
    );
    assert.equal(
      isStaleTitleYear(
        "AI Agents Hackathon 2025",
        { startDate: "2026-09-01", deadline: "2026-08-01" },
        NOW,
      ),
      false,
    );
  });

  it("parses deadline separately from event date range", () => {
    const parsed = parseDatesFromText(
      "Hackathon Sep 13-15, 2026. Registration deadline: 2026-08-01",
      NOW,
    );
    assert.equal(parsed.startDate, "2026-09-13");
    assert.equal(parsed.endDate, "2026-09-15");
    assert.equal(parsed.deadline, "2026-08-01");
  });

  it("uses injected now for days-left deadlines", () => {
    const parsed = parseDatesFromText("Apply now — 5 days left", NOW);
    assert.equal(parsed.deadline, "2026-07-16");
  });
});
