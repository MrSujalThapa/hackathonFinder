import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatDateRange,
  formatLocation,
  formatSourceLabel,
  hostnameFromUrl,
} from "@/lib/candidates/format";
import { PREVIEW_CANDIDATE } from "@/lib/candidates/preview";

describe("candidate format helpers", () => {
  it("formats missing dates as unclear", () => {
    assert.equal(formatDateRange(null, null), "Date unclear");
  });

  it("formats location fallbacks", () => {
    assert.equal(formatLocation(PREVIEW_CANDIDATE), "Toronto, Canada");
    assert.equal(
      formatLocation({
        ...PREVIEW_CANDIDATE,
        location: null,
        city: null,
        country: null,
        mode: "online",
      }),
      "Online",
    );
  });

  it("extracts hostnames safely", () => {
    assert.equal(hostnameFromUrl("https://www.example.com/path"), "example.com");
    assert.equal(hostnameFromUrl(null), null);
  });

  it("formats known source labels", () => {
    assert.equal(formatSourceLabel("mock"), "Mock");
    assert.equal(formatSourceLabel("hacklist"), "HackList");
    assert.equal(formatSourceLabel("hakku"), "Hakku");
    assert.equal(formatSourceLabel("devpost"), "Devpost");
    assert.equal(formatSourceLabel("mlh"), "MLH");
    assert.equal(formatSourceLabel("luma"), "Luma");
    assert.equal(formatSourceLabel("web"), "Web");
    assert.equal(formatSourceLabel("x"), "X");
    assert.equal(formatSourceLabel("twitter"), "X");
  });

  it("title-cases unknown source labels", () => {
    assert.equal(formatSourceLabel("web_search"), "Web Search");
  });
});
