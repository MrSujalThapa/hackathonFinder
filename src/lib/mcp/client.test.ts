import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { McpClient, normalizeMcpContentBlocks } from "@/lib/mcp/client";
import { McpError } from "@/lib/mcp/errors";
import {
  createHttpMcpTransport,
  DEFAULT_MAX_RESPONSE_BYTES,
  parseSseJsonRpc,
} from "@/lib/mcp/httpTransport";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpTransport,
  McpTransportRequest,
  McpTransportResponse,
} from "@/lib/mcp/types";
import { MCP_PROTOCOL_VERSION } from "@/lib/mcp/types";

type FakeHandler = (
  request: McpTransportRequest,
) => Promise<McpTransportResponse> | McpTransportResponse;

function fakeTransport(handler: FakeHandler): McpTransport {
  return {
    send: async (request) => handler(request),
  };
}

function jsonResponse(
  body: JsonRpcResponse,
  headers: Record<string, string> = {},
  status = 200,
): McpTransportResponse {
  return { status, headers, body };
}

describe("McpClient with fake transport", () => {
  it("initialize + listTools + callTool happy path", async () => {
    const calls: string[] = [];
    let sessionSeen = false;

    const transport = fakeTransport((request) => {
      const method = request.message.method;
      calls.push(method);

      if (method === "initialize") {
        return jsonResponse(
          {
            jsonrpc: "2.0",
            id: (request.message as JsonRpcRequest).id,
            result: {
              protocolVersion: MCP_PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: { name: "xmcp", version: "1.0.0" },
            },
          },
          { "mcp-session-id": "sess-abc" },
        );
      }

      if (method === "notifications/initialized") {
        sessionSeen = Boolean(request.headers?.["Mcp-Session-Id"]);
        assert.equal(
          request.headers?.["MCP-Protocol-Version"],
          MCP_PROTOCOL_VERSION,
        );
        return { status: 202, headers: {}, body: null };
      }

      if (method === "tools/list") {
        assert.equal(request.headers?.["Mcp-Session-Id"], "sess-abc");
        return jsonResponse({
          jsonrpc: "2.0",
          id: (request.message as JsonRpcRequest).id,
          result: {
            tools: [
              {
                name: "search_posts",
                description: "Search recent posts / tweets",
                inputSchema: { type: "object" },
              },
            ],
          },
        });
      }

      if (method === "tools/call") {
        const params = (request.message as JsonRpcRequest).params as {
          name: string;
          arguments: Record<string, unknown>;
        };
        assert.equal(params.name, "search_posts");
        assert.equal(params.arguments.query, "hackathon");
        return jsonResponse({
          jsonrpc: "2.0",
          id: (request.message as JsonRpcRequest).id,
          result: {
            content: [{ type: "text", text: "found 1 post" }],
            isError: false,
          },
        });
      }

      throw new Error(`unexpected method ${method}`);
    });

    const client = new McpClient({ transport });
    const init = await client.initialize();
    assert.equal(init.serverInfo.name, "xmcp");
    assert.equal(client.getSessionId(), "sess-abc");
    assert.equal(client.getProtocolVersion(), MCP_PROTOCOL_VERSION);
    assert.equal(sessionSeen, true);

    const tools = await client.listTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.name, "search_posts");

    const result = await client.callTool("search_posts", {
      query: "hackathon",
    });
    assert.equal(result.content[0]?.type, "text");
    if (result.content[0]?.type === "text") {
      assert.equal(result.content[0].text, "found 1 post");
    }

    assert.deepEqual(calls, [
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
    ]);
  });

  it("maps missing-tool JSON-RPC errors", async () => {
    const transport = fakeTransport((request) => {
      if (request.message.method === "initialize") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: (request.message as JsonRpcRequest).id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            serverInfo: { name: "t", version: "0" },
          },
        });
      }
      if (request.message.method === "notifications/initialized") {
        return { status: 202, headers: {}, body: null };
      }
      return jsonResponse({
        jsonrpc: "2.0",
        id: (request.message as JsonRpcRequest).id,
        error: { code: -32601, message: "Unknown tool: nope" },
      });
    });

    const client = new McpClient({ transport });
    await client.initialize();
    await assert.rejects(
      () => client.callTool("nope"),
      (error: unknown) =>
        error instanceof McpError && error.category === "missing_tool",
    );
  });
});

describe("normalizeMcpContentBlocks", () => {
  it("normalizes known and unknown blocks", () => {
    const blocks = normalizeMcpContentBlocks([
      { type: "text", text: "hi" },
      { type: "image", data: "abc", mimeType: "image/png" },
      { type: "resource", resource: { uri: "https://x.com/1", text: "t" } },
      { type: "weird", foo: 1 },
      null,
    ]);
    assert.equal(blocks[0]?.type, "text");
    assert.equal(blocks[1]?.type, "image");
    assert.equal(blocks[2]?.type, "resource");
    assert.equal(blocks[3]?.type, "unknown");
    assert.equal(blocks[4]?.type, "unknown");
  });
});

describe("parseSseJsonRpc", () => {
  it("extracts matching JSON-RPC response from SSE frames", () => {
    const body = [
      "event: message",
      'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}',
      "",
      "event: message",
      'data: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}',
      "",
    ].join("\n");
    const parsed = parseSseJsonRpc(body, 7, 200);
    assert.deepEqual(parsed.result, { ok: true });
  });
});

describe("createHttpMcpTransport", () => {
  it("classifies 401 as auth", async () => {
    const transport = createHttpMcpTransport({
      url: "https://example.test/mcp",
      bearerToken: "tok",
      fetchImpl: async () =>
        new Response("unauthorized", {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    });

    await assert.rejects(
      () =>
        transport.send({
          message: {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {},
          },
        }),
      (error: unknown) =>
        error instanceof McpError &&
        error.category === "auth" &&
        error.status === 401 &&
        !/Bearer\s+tok/i.test(error.message),
    );
  });

  it("classifies 429 as rate_quota", async () => {
    const transport = createHttpMcpTransport({
      url: "https://example.test/mcp",
      bearerToken: "tok",
      fetchImpl: async () =>
        new Response("rate limit exceeded", {
          status: 429,
          headers: { "Content-Type": "text/plain" },
        }),
    });

    await assert.rejects(
      () =>
        transport.send({
          message: { jsonrpc: "2.0", id: 1, method: "tools/list" },
        }),
      (error: unknown) =>
        error instanceof McpError && error.category === "rate_quota",
    );
  });

  it("classifies abort as timeout", async () => {
    const transport = createHttpMcpTransport({
      url: "https://example.test/mcp",
      bearerToken: "tok",
      timeoutMs: 20,
      fetchImpl: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    });

    await assert.rejects(
      () =>
        transport.send({
          message: { jsonrpc: "2.0", id: 1, method: "tools/list" },
        }),
      (error: unknown) =>
        error instanceof McpError && error.category === "timeout",
    );
  });

  it("rejects malformed JSON", async () => {
    const transport = createHttpMcpTransport({
      url: "https://example.test/mcp",
      bearerToken: "tok",
      fetchImpl: async () =>
        new Response("not-json{", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    await assert.rejects(
      () =>
        transport.send({
          message: { jsonrpc: "2.0", id: 1, method: "tools/list" },
        }),
      (error: unknown) =>
        error instanceof McpError && error.category === "malformed",
    );
  });

  it("rejects oversized responses", async () => {
    const oversized = "x".repeat(DEFAULT_MAX_RESPONSE_BYTES + 10);
    const transport = createHttpMcpTransport({
      url: "https://example.test/mcp",
      bearerToken: "tok",
      maxResponseBytes: 1024,
      fetchImpl: async () =>
        new Response(oversized, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(oversized.length),
          },
        }),
    });

    await assert.rejects(
      () =>
        transport.send({
          message: { jsonrpc: "2.0", id: 1, method: "tools/list" },
        }),
      (error: unknown) =>
        error instanceof McpError &&
        error.category === "malformed" &&
        /max size/i.test(error.message),
    );
  });

  it("parses application/json success and redacts auth in headers sent", async () => {
    let seenAuth: string | undefined;
    const transport = createHttpMcpTransport({
      url: "https://example.test/mcp",
      bearerToken: "super-secret",
      fetchImpl: async (_url, init) => {
        const headers = init?.headers as Record<string, string>;
        seenAuth = headers.Authorization;
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { tools: [] },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    });

    const response = await transport.send({
      message: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    assert.equal(seenAuth, "Bearer super-secret");
    assert.deepEqual(response.body?.result, { tools: [] });
  });

  it("parses SSE success responses", async () => {
    const sse = [
      "event: message",
      'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"a"}]}}',
      "",
    ].join("\n");

    const transport = createHttpMcpTransport({
      url: "https://example.test/mcp",
      bearerToken: "tok",
      fetchImpl: async () =>
        new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
    });

    const response = await transport.send({
      message: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    assert.deepEqual(response.body?.result, {
      tools: [{ name: "a" }],
    });
  });
});
