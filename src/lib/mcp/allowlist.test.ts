import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertXToolAllowed,
  evaluateXToolPolicy,
  selectAllowedXTools,
  selectPublicPostSearchTools,
  xReadOnlyToolPolicy,
} from "@/lib/mcp/allowlist";
import { McpClient } from "@/lib/mcp/client";
import { McpError } from "@/lib/mcp/errors";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpTool,
  McpTransport,
  McpTransportRequest,
  McpTransportResponse,
} from "@/lib/mcp/types";
import { MCP_PROTOCOL_VERSION } from "@/lib/mcp/types";

function decision(name: string, description?: string) {
  return evaluateXToolPolicy({ name, description });
}

describe("evaluateXToolPolicy — allow", () => {
  it("allows search/get post tools", () => {
    for (const tool of [
      { name: "search_posts" },
      { name: "search_all", description: "Search all public posts" },
      { name: "search_recent_posts" },
      { name: "get_post" },
      { name: "get_posts", description: "Retrieve posts by id" },
      { name: "fetch_tweet" },
      {
        name: "posts_lookup",
        description: "Lookup public posts by ids",
      },
    ]) {
      const result = decision(tool.name, tool.description);
      assert.equal(
        result.allowed,
        true,
        `${tool.name} should be allowed: ${result.reason}`,
      );
    }
  });

  it("allows user lookup for attribution", () => {
    for (const tool of [
      { name: "lookup_user" },
      { name: "get_user" },
      { name: "fetch_users", description: "Fetch public user profiles" },
      { name: "users_lookup" },
    ]) {
      const result = decision(tool.name, tool.description);
      assert.equal(
        result.allowed,
        true,
        `${tool.name} should be allowed: ${result.reason}`,
      );
    }
  });
});

describe("evaluateXToolPolicy — deny mutations", () => {
  it("rejects create post / like / DM / follow / bookmark / article publish", () => {
    const blocked: Array<{ name: string; description?: string }> = [
      { name: "create_tweet", description: "Create a new tweet" },
      { name: "post_tweet" },
      { name: "publish_status", description: "Publish a status update" },
      { name: "delete_tweet" },
      { name: "like_post" },
      { name: "favorite_tweet" },
      { name: "send_dm", description: "Send a direct message" },
      { name: "create_direct_message" },
      { name: "follow_user" },
      { name: "unfollow_user" },
      { name: "add_bookmark" },
      { name: "remove_bookmark" },
      { name: "list_bookmarks", description: "List bookmarked posts" },
      { name: "create_article_draft" },
      { name: "publish_article" },
      { name: "repost_tweet" },
      { name: "retweet" },
    ];

    for (const tool of blocked) {
      const result = decision(tool.name, tool.description);
      assert.equal(
        result.allowed,
        false,
        `${tool.name} should be blocked: ${result.reason}`,
      );
    }
  });

  it("rejects unknown tools by default", () => {
    const result = decision("manage_lists", "Organize account lists");
    assert.equal(result.allowed, false);
    assert.match(result.reason, /denied by default/i);
  });
});

describe("assertXToolAllowed / selectors", () => {
  const catalog: McpTool[] = [
    { name: "search_posts", description: "Search recent posts" },
    { name: "lookup_user", description: "Look up a public user" },
    { name: "like_post", description: "Like a post" },
    { name: "trends_get", description: "Get trends" },
  ];

  it("assertXToolAllowed throws policy for blocked tools", () => {
    assert.throws(
      () => assertXToolAllowed("like_post", catalog),
      (error: unknown) =>
        error instanceof McpError &&
        error.category === "policy" &&
        /blocked by read-only policy/i.test(error.message),
    );
  });

  it("assertXToolAllowed throws missing_tool when absent from catalog", () => {
    assert.throws(
      () => assertXToolAllowed("nope", catalog),
      (error: unknown) =>
        error instanceof McpError && error.category === "missing_tool",
    );
  });

  it("selectAllowedXTools and selectPublicPostSearchTools", () => {
    const allowed = selectAllowedXTools(catalog).map((t) => t.name);
    assert.deepEqual(allowed.sort(), ["lookup_user", "search_posts"]);

    const search = selectPublicPostSearchTools(catalog).map((t) => t.name);
    assert.deepEqual(search, ["search_posts"]);
  });
});

describe("McpClient toolPolicy integration", () => {
  it("never invokes transport for blocked tools", async () => {
    const methods: string[] = [];

    const transport: McpTransport = {
      async send(request: McpTransportRequest): Promise<McpTransportResponse> {
        const method = request.message.method;
        methods.push(method);

        if (method === "initialize") {
          return {
            status: 200,
            headers: {},
            body: {
              jsonrpc: "2.0",
              id: (request.message as JsonRpcRequest).id,
              result: {
                protocolVersion: MCP_PROTOCOL_VERSION,
                capabilities: {},
                serverInfo: { name: "xmcp", version: "1" },
              },
            } satisfies JsonRpcResponse,
          };
        }
        if (method === "notifications/initialized") {
          return { status: 202, headers: {}, body: null };
        }
        if (method === "tools/list") {
          return {
            status: 200,
            headers: {},
            body: {
              jsonrpc: "2.0",
              id: (request.message as JsonRpcRequest).id,
              result: {
                tools: [
                  {
                    name: "search_posts",
                    description: "Search public posts",
                  },
                  { name: "like_post", description: "Like a post" },
                ],
              },
            },
          };
        }
        if (method === "tools/call") {
          throw new Error("transport should not be called for blocked tools");
        }
        throw new Error(`unexpected ${method}`);
      },
    };

    const client = new McpClient({
      transport,
      toolPolicy: xReadOnlyToolPolicy,
    });
    await client.initialize();
    await client.listTools();

    await assert.rejects(
      () => client.callTool("like_post", { id: "1" }),
      (error: unknown) =>
        error instanceof McpError && error.category === "policy",
    );

    assert.ok(!methods.includes("tools/call"));

    // Allowed tool still reaches transport.
    let called = false;
    const transport2: McpTransport = {
      async send(request) {
        if (request.message.method === "initialize") {
          return {
            status: 200,
            headers: {},
            body: {
              jsonrpc: "2.0",
              id: (request.message as JsonRpcRequest).id,
              result: {
                protocolVersion: MCP_PROTOCOL_VERSION,
                capabilities: {},
                serverInfo: { name: "xmcp", version: "1" },
              },
            },
          };
        }
        if (request.message.method === "notifications/initialized") {
          return { status: 202, headers: {}, body: null };
        }
        if (request.message.method === "tools/call") {
          called = true;
          return {
            status: 200,
            headers: {},
            body: {
              jsonrpc: "2.0",
              id: (request.message as JsonRpcRequest).id,
              result: { content: [{ type: "text", text: "ok" }] },
            },
          };
        }
        throw new Error(`unexpected ${request.message.method}`);
      },
    };

    const client2 = new McpClient({
      transport: transport2,
      toolPolicy: xReadOnlyToolPolicy,
    });
    await client2.initialize();
    const result = await client2.callTool("search_posts", { query: "x" });
    assert.equal(called, true);
    assert.equal(result.content[0]?.type, "text");
  });
});
