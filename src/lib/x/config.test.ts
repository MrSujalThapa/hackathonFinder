import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  describeXMcpConfig,
  getXBearerToken,
  getXMcpConfig,
  isXConfigured,
  parsePositiveInt,
  requireXMcpConfig,
} from "@/lib/x/config";

const ENV_KEYS = [
  "X_MCP_MODE",
  "X_MCP_URL",
  "X_BEARER_TOKEN",
  "X_MAX_QUERIES_PER_RUN",
  "X_MAX_POSTS_PER_QUERY",
  "X_TOTAL_POST_LIMIT",
  "X_REQUEST_TIMEOUT_MS",
] as const;

const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {};

function stashEnv(): void {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  stashEnv();
});

afterEach(() => {
  restoreEnv();
});

describe("parsePositiveInt", () => {
  it("uses fallback for empty/invalid", () => {
    assert.equal(parsePositiveInt(undefined, 6), 6);
    assert.equal(parsePositiveInt("", 6), 6);
    assert.equal(parsePositiveInt("abc", 6), 6);
    assert.equal(parsePositiveInt("0", 6), 6);
    assert.equal(parsePositiveInt("-3", 6), 6);
  });

  it("parses positive integers", () => {
    assert.equal(parsePositiveInt("20", 6), 20);
  });
});

describe("getXMcpConfig", () => {
  it("returns defaults when env unset", () => {
    const config = getXMcpConfig();
    assert.equal(config.mode, "app-only");
    assert.equal(config.url, "https://api.x.com/mcp");
    assert.equal(config.maxQueriesPerRun, 6);
    assert.equal(config.maxPostsPerQuery, 20);
    assert.equal(config.totalPostLimit, 60);
    assert.equal(config.requestTimeoutMs, 15_000);
    assert.equal(isXConfigured(), false);
  });

  it("reads overrides and token presence", () => {
    process.env.X_BEARER_TOKEN = "secret-token-value";
    process.env.X_MCP_URL = "https://example.test/mcp";
    process.env.X_MAX_QUERIES_PER_RUN = "3";
    process.env.X_MAX_POSTS_PER_QUERY = "10";
    process.env.X_TOTAL_POST_LIMIT = "30";
    process.env.X_REQUEST_TIMEOUT_MS = "5000";

    assert.equal(isXConfigured(), true);
    assert.equal(getXBearerToken(), "secret-token-value");

    const config = getXMcpConfig();
    assert.equal(config.url, "https://example.test/mcp");
    assert.equal(config.maxQueriesPerRun, 3);
    assert.equal(config.maxPostsPerQuery, 10);
    assert.equal(config.totalPostLimit, 30);
    assert.equal(config.requestTimeoutMs, 5000);

    const described = describeXMcpConfig();
    assert.ok(described.includes("token=set"));
    assert.ok(!described.includes("secret-token-value"));

    const required = requireXMcpConfig();
    assert.equal(required.bearerToken, "secret-token-value");
  });

  it("requireXMcpConfig throws when unconfigured", () => {
    assert.throws(() => requireXMcpConfig(), /not configured/i);
  });
});
