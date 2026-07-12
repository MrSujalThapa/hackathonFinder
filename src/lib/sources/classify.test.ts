import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyCollectorResult } from "@/collectors/types";
import {
  classifyCollectorResult,
  classifyFailureText,
} from "@/lib/sources/classify";

describe("classifyFailureText", () => {
  it("detects common failure categories", () => {
    assert.equal(classifyFailureText("rate limit exceeded"), "rate_limit");
    assert.equal(classifyFailureText("ENOTFOUND api.example.com"), "network");
    assert.equal(classifyFailureText("Cloudflare captcha blocked"), "anti_bot");
    assert.equal(classifyFailureText("SEARCH_API_KEY not configured"), "missing_api_key");
    assert.equal(classifyFailureText("login required"), "auth_required");
    assert.equal(classifyFailureText("session expired reconnect"), "session_expired");
    assert.equal(classifyFailureText("selector changed / parser failed"), "selector_parser_failure");
    assert.equal(classifyFailureText("no promising hackathon results"), "zero_matching_results");
  });
});

describe("classifyCollectorResult", () => {
  it("marks leads as healthy", () => {
    const result = emptyCollectorResult("mlh");
    result.leads = [
      {
        id: "1",
        source: "mlh",
        links: ["https://mlh.com/e"],
        postedAt: new Date().toISOString(),
      },
    ];
    const classified = classifyCollectorResult("mlh", result);
    assert.equal(classified.status, "healthy");
    assert.equal(classified.leadsFound, 1);
    assert.equal(classified.failureCategory, undefined);
  });

  it("does not treat blank zero-result as healthy", () => {
    const result = emptyCollectorResult("hacklist");
    const classified = classifyCollectorResult("hacklist", result);
    assert.equal(classified.status, "degraded");
    assert.equal(classified.failureCategory, "zero_matching_results");
  });

  it("maps auth warnings for hakku", () => {
    const result = emptyCollectorResult("hakku");
    result.warnings.push("Hakku requires login; public swipe cards are not available");
    const classified = classifyCollectorResult("hakku", result, {
      authenticated: false,
    });
    assert.equal(classified.status, "auth_required");
    assert.equal(classified.failureCategory, "auth_required");
  });

  it("maps hard errors to failed/network", () => {
    const result = emptyCollectorResult("devpost");
    result.errors.push("fetch failed: ECONNREFUSED");
    const classified = classifyCollectorResult("devpost", result);
    assert.equal(classified.status, "failed");
    assert.equal(classified.failureCategory, "network");
  });

  it("maps missing api key to unconfigured", () => {
    const result = emptyCollectorResult("web");
    result.errors.push("SEARCH_PROVIDER/SEARCH_API_KEY not configured");
    const classified = classifyCollectorResult("web", result);
    assert.equal(classified.status, "unconfigured");
    assert.equal(classified.failureCategory, "missing_api_key");
  });

  it("respects preStatus overrides", () => {
    const result = emptyCollectorResult("mlh");
    const classified = classifyCollectorResult("mlh", result, {
      preStatus: "disabled",
      preCategory: "disabled",
      preMessage: "off",
    });
    assert.equal(classified.status, "disabled");
    assert.equal(classified.failureCategory, "disabled");
  });
});
