import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  buildXSearchToolArgs,
  canonicalizeXPostUrl,
  createXMcpCollector,
  expandPostUrls,
  isPromisingXPost,
  parseXPostsFromCallResult,
  xMcpCollector,
  xPostToLead,
  type ParsedXPost,
} from "@/collectors/xMcp";
import { createMcpClient } from "@/lib/mcp/client";
import { McpError } from "@/lib/mcp/errors";
import { xReadOnlyToolPolicy } from "@/lib/mcp/allowlist";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpCallToolResult,
  McpTool,
  McpTransport,
  McpTransportRequest,
  McpTransportResponse,
} from "@/lib/mcp/types";
import { MCP_PROTOCOL_VERSION } from "@/lib/mcp/types";
import type { DiscoveryPreferences } from "@/core/discovery/types";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
  "x-mcp-search.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  tools: McpTool[];
  searchCallResult: McpCallToolResult;
  malformedCallResult: McpCallToolResult;
};

const preferences: DiscoveryPreferences = {
  rawCommand: "find AI hackathons in Toronto or remote",
  locations: ["Toronto", "Canada"],
  dateFrom: "2026-07-01",
  dateTo: "2026-12-31",
  themes: ["AI"],
  modes: ["online", "in-person"],
  sources: ["x"],
  includeRemote: true,
  includeInPerson: true,
  maxResults: 10,
};

function jsonResponse(
  body: JsonRpcResponse,
  headers: Record<string, string> = {},
  status = 200,
): McpTransportResponse {
  return { status, headers, body };
}

type FakeOpts = {
  tools?: McpTool[];
  searchResult?: McpCallToolResult | ((query: string) => McpCallToolResult);
  onCallTool?: (name: string, args: Record<string, unknown>) => void;
  failSearchWith?: McpError;
  failListWith?: McpError;
};

function createFakeClient(opts: FakeOpts = {}) {
  const tools = opts.tools ?? fixture.tools;
  const calledTools: string[] = [];

  const transport: McpTransport = {
    async send(request: McpTransportRequest): Promise<McpTransportResponse> {
      const method = request.message.method;

      if (method === "initialize") {
        return jsonResponse(
          {
            jsonrpc: "2.0",
            id: (request.message as JsonRpcRequest).id,
            result: {
              protocolVersion: MCP_PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: { name: "x-fake", version: "1.0.0" },
            },
          },
          { "mcp-session-id": "fake-sess" },
        );
      }

      if (method === "notifications/initialized") {
        return { status: 202, headers: {}, body: null };
      }

      if (method === "tools/list") {
        if (opts.failListWith) throw opts.failListWith;
        return jsonResponse({
          jsonrpc: "2.0",
          id: (request.message as JsonRpcRequest).id,
          result: { tools },
        });
      }

      if (method === "tools/call") {
        const params = (request.message as JsonRpcRequest).params as {
          name: string;
          arguments: Record<string, unknown>;
        };
        calledTools.push(params.name);
        opts.onCallTool?.(params.name, params.arguments ?? {});

        if (opts.failSearchWith) throw opts.failSearchWith;

        const query = String(
          params.arguments?.query ?? params.arguments?.q ?? "",
        );
        const searchResult =
          typeof opts.searchResult === "function"
            ? opts.searchResult(query)
            : (opts.searchResult ?? fixture.searchCallResult);

        return jsonResponse({
          jsonrpc: "2.0",
          id: (request.message as JsonRpcRequest).id,
          result: searchResult,
        });
      }

      throw new Error(`unexpected method ${method}`);
    },
  };

  const client = createMcpClient({
    transport,
    toolPolicy: xReadOnlyToolPolicy,
  });

  return { client, calledTools };
}

describe("parseXPostsFromCallResult", () => {
  it("parses structured JSON text content with includes.users", () => {
    const posts = parseXPostsFromCallResult(fixture.searchCallResult);
    assert.ok(posts.length >= 3);
    const first = posts.find((p) => p.id === "1900000000000000001");
    assert.ok(first);
    assert.match(first!.text, /Applications open/i);
    assert.equal(first!.username, "HackTO");
    assert.ok(
      first!.expandedUrls.some((u) => u.includes("hackto.example.com")),
    );
  });

  it("handles malformed text without throwing", () => {
    const posts = parseXPostsFromCallResult(fixture.malformedCallResult);
    assert.deepEqual(posts, []);
  });

  it("parses structuredContent arrays", () => {
    const posts = parseXPostsFromCallResult({
      content: [],
      structuredContent: {
        posts: [
          {
            id: "99",
            text: "hackathon registration open",
            created_at: "2026-07-01T00:00:00Z",
            author: { username: "org" },
          },
        ],
      },
    });
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.id, "99");
    assert.equal(posts[0]?.username, "org");
  });
});

describe("URL expansion and canonicalization", () => {
  it("builds canonical x.com status URLs", () => {
    assert.equal(
      canonicalizeXPostUrl("123", "HackTO"),
      "https://x.com/HackTO/status/123",
    );
    assert.equal(
      canonicalizeXPostUrl("123"),
      "https://x.com/i/status/123",
    );
  });

  it("expands entity URLs and includes social URL", () => {
    const post: ParsedXPost = {
      id: "1",
      text: "see https://t.co/x",
      expandedUrls: ["https://hackto.example.com/ai"],
      username: "HackTO",
    };
    const social = canonicalizeXPostUrl(post.id, post.username);
    const urls = expandPostUrls(post, social);
    assert.ok(urls.some((u) => u.includes("hackto.example.com")));
    assert.ok(urls.some((u) => u.includes("/status/1")));
  });
});

describe("announcement filter", () => {
  it("retains announcements with apply signal or outbound event link", () => {
    assert.equal(
      isPromisingXPost({
        id: "1",
        text: "Applications open for Toronto AI Hackathon 2026! Prize pool.",
        expandedUrls: [],
        createdAt: "2026-07-01T00:00:00Z",
      }),
      true,
    );
    assert.equal(
      isPromisingXPost({
        id: "2",
        text: "MLH buildathon registration open this weekend — join us building!",
        expandedUrls: [],
        createdAt: "2026-07-02T00:00:00Z",
      }),
      true,
    );
  });

  it("rejects commentary and historical throwbacks", () => {
    assert.equal(
      isPromisingXPost({
        id: "3",
        text: "What is a hackathon? Tips for beginners — wikipedia style guide",
        expandedUrls: [],
      }),
      false,
    );
    assert.equal(
      isPromisingXPost({
        id: "4",
        text: "Throwback! I attended last year — recap of 2021 hackathon weekend.",
        expandedUrls: [],
        createdAt: "2026-05-01T00:00:00Z",
      }),
      false,
    );
  });
});

describe("buildXSearchToolArgs", () => {
  it("maps query/max_results from schema and clamps via caller", () => {
    const tool = fixture.tools[0]!;
    const args = buildXSearchToolArgs(tool, "hackathon Toronto", 20);
    assert.equal(args.query, "hackathon Toronto");
    assert.equal(args.max_results, 20);
  });

  it("supports q/limit schema names", () => {
    const tool: McpTool = {
      name: "search_all",
      description: "Search all public posts",
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string" },
          limit: { type: "integer" },
        },
      },
    };
    const args = buildXSearchToolArgs(tool, "deadline", 5);
    assert.equal(args.q, "deadline");
    assert.equal(args.limit, 5);
  });
});

describe("createXMcpCollector", () => {
  it("warns and returns empty leads when X config is missing", async () => {
    const collector = createXMcpCollector({
      isConfigured: () => false,
    });
    const result = await collector.collect({
      preferences,
      maxResults: 10,
      timeoutMs: 5000,
      dryRun: true,
    });
    assert.equal(result.source, "x");
    assert.equal(result.leads.length, 0);
    assert.ok(result.warnings.some((w) => /not configured/i.test(w)));
    assert.equal(result.errors.length, 0);
  });

  it("keeps default collector missing-auth path non-throwing", async () => {
    const prev = process.env.X_BEARER_TOKEN;
    delete process.env.X_BEARER_TOKEN;
    try {
      const result = await xMcpCollector.collect({
        preferences,
        maxResults: 5,
        timeoutMs: 2000,
        dryRun: true,
      });
      assert.equal(result.leads.length, 0);
      assert.ok(result.warnings.length + result.errors.length >= 1);
    } finally {
      if (prev !== undefined) process.env.X_BEARER_TOKEN = prev;
      else delete process.env.X_BEARER_TOKEN;
    }
  });

  it("parses fixture posts, expands URLs, canonicalizes, and dedupes", async () => {
    const { client, calledTools } = createFakeClient();
    const collector = createXMcpCollector({
      createClient: async () => ({ client }),
      getConfig: () => ({
        mode: "app-only",
        url: "https://example.test/mcp",
        maxQueriesPerRun: 2,
        maxPostsPerQuery: 10,
        totalPostLimit: 20,
        requestTimeoutMs: 5000,
      }),
    });

    const result = await collector.collect({
      preferences,
      maxResults: 10,
      timeoutMs: 5000,
      dryRun: true,
    });

    assert.equal(result.errors.length, 0);
    assert.ok(result.leads.length >= 1);
    assert.ok(result.leads.length <= 2); // fixture has 2 promising unique posts

    const announcement = result.leads.find((l) =>
      /Applications open/i.test(l.text ?? ""),
    );
    assert.ok(announcement);
    assert.equal(announcement!.source, "x");
    assert.equal(announcement!.id, "x-1900000000000000001");
    assert.equal(
      announcement!.url,
      "https://x.com/HackTO/status/1900000000000000001",
    );
    assert.ok(
      announcement!.links.some((u) => u.includes("hackto.example.com")),
    );
    assert.equal(announcement!.metadata?.evidenceType, "x_post");
    assert.equal(announcement!.metadata?.officialUrl, "https://hackto.example.com/ai-2026");
    assert.equal(
      (announcement!.metadata?.sourceIds as { x?: string } | undefined)?.x,
      "1900000000000000001",
    );

    // Commentary / throwback rejected
    assert.ok(!result.leads.some((l) => /what is a hackathon/i.test(l.text ?? "")));
    assert.ok(!result.leads.some((l) => /throwback/i.test(l.text ?? "")));

    // Duplicate id only once
    const ids = result.leads.map((l) => l.id);
    assert.equal(new Set(ids).size, ids.length);

    assert.ok(calledTools.every((name) => name === "search_posts"));
    assert.ok(!calledTools.includes("create_tweet"));
    assert.ok(!calledTools.includes("like_post"));
  });

  it("never calls blocked mutation tools (real allowlist on client)", async () => {
    const { client, calledTools } = createFakeClient();
    // Direct attempt must be blocked by policy before transport
    await assert.rejects(
      () => client.callTool("create_tweet", { text: "hi" }),
      (error: unknown) =>
        error instanceof McpError && error.category === "policy",
    );

    const collector = createXMcpCollector({
      createClient: async () => ({ client }),
      getConfig: () => ({
        mode: "app-only",
        url: "https://example.test/mcp",
        maxQueriesPerRun: 1,
        maxPostsPerQuery: 5,
        totalPostLimit: 5,
        requestTimeoutMs: 3000,
      }),
    });

    await collector.collect({
      preferences,
      maxResults: 5,
      timeoutMs: 3000,
      dryRun: true,
    });

    assert.deepEqual([...new Set(calledTools)], ["search_posts"]);
  });

  it("isolates rate errors as warnings without crashing", async () => {
    const { client } = createFakeClient({
      failSearchWith: new McpError("rate_quota", "Too many requests"),
    });
    const collector = createXMcpCollector({
      createClient: async () => ({ client }),
      getConfig: () => ({
        mode: "app-only",
        url: "https://example.test/mcp",
        maxQueriesPerRun: 1,
        maxPostsPerQuery: 5,
        totalPostLimit: 5,
        requestTimeoutMs: 3000,
      }),
    });

    const result = await collector.collect({
      preferences,
      maxResults: 5,
      timeoutMs: 3000,
      dryRun: true,
    });

    assert.equal(result.leads.length, 0);
    assert.ok(result.warnings.some((w) => /rate_quota/i.test(w)));
    assert.equal(result.errors.length, 0);
  });

  it("records auth errors without throwing from collect", async () => {
    const { client } = createFakeClient({
      failSearchWith: new McpError("auth", "Unauthorized"),
    });
    const collector = createXMcpCollector({
      createClient: async () => ({ client }),
      getConfig: () => ({
        mode: "app-only",
        url: "https://example.test/mcp",
        maxQueriesPerRun: 2,
        maxPostsPerQuery: 5,
        totalPostLimit: 5,
        requestTimeoutMs: 3000,
      }),
    });

    const result = await collector.collect({
      preferences,
      maxResults: 5,
      timeoutMs: 3000,
      dryRun: true,
    });

    assert.equal(result.leads.length, 0);
    assert.ok(result.errors.some((e) => /auth/i.test(e)));
  });

  it("warns when no public search tools are available", async () => {
    const { client } = createFakeClient({
      tools: [
        { name: "create_tweet", description: "Create a new tweet" },
        { name: "like_post", description: "Like a post" },
      ],
    });
    const collector = createXMcpCollector({
      createClient: async () => ({ client }),
      getConfig: () => ({
        mode: "app-only",
        url: "https://example.test/mcp",
        maxQueriesPerRun: 1,
        maxPostsPerQuery: 5,
        totalPostLimit: 5,
        requestTimeoutMs: 3000,
      }),
    });

    const result = await collector.collect({
      preferences,
      maxResults: 5,
      timeoutMs: 3000,
      dryRun: true,
    });

    assert.equal(result.leads.length, 0);
    assert.ok(result.warnings.some((w) => /no public post search/i.test(w)));
  });

  it("maps xPostToLead metadata for a filtered announcement", () => {
    const posts = parseXPostsFromCallResult(fixture.searchCallResult);
    const announcement = posts.find((p) => p.id === "1900000000000000001")!;
    const lead = xPostToLead(announcement, "hackathon Toronto");
    assert.ok(lead);
    assert.equal(lead!.metadata?.query, "hackathon Toronto");
    assert.equal(lead!.metadata?.username, "HackTO");
    assert.equal(lead!.metadata?.postId, "1900000000000000001");
  });
});
