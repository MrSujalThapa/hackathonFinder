import {
  classifyMessageText,
  McpError,
} from "@/lib/mcp/errors";
import type {
  JsonRpcId,
  JsonRpcNotification,
  JsonRpcRequest,
  McpCallToolResult,
  McpClientOptions,
  McpContentBlock,
  McpInitializeResult,
  McpTool,
  McpTransport,
  McpTransportResponse,
} from "@/lib/mcp/types";
import {
  MCP_CLIENT_INFO,
  MCP_PROTOCOL_VERSION,
} from "@/lib/mcp/types";

let nextId = 1;

function allocId(): number {
  const id = nextId;
  nextId += 1;
  return id;
}

function headerGet(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  return headers[lower] ?? headers[name];
}

function normalizeContentBlocks(raw: unknown): McpContentBlock[] {
  if (!Array.isArray(raw)) return [];
  const blocks: McpContentBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      blocks.push({ type: "unknown", raw: item });
      continue;
    }
    const obj = item as Record<string, unknown>;
    if (obj.type === "text" && typeof obj.text === "string") {
      blocks.push({ type: "text", text: obj.text });
      continue;
    }
    if (
      obj.type === "image" &&
      typeof obj.data === "string" &&
      typeof obj.mimeType === "string"
    ) {
      blocks.push({
        type: "image",
        data: obj.data,
        mimeType: obj.mimeType,
      });
      continue;
    }
    if (obj.type === "resource" && obj.resource && typeof obj.resource === "object") {
      const resource = obj.resource as Record<string, unknown>;
      if (typeof resource.uri === "string") {
        blocks.push({
          type: "resource",
          resource: {
            uri: resource.uri,
            mimeType:
              typeof resource.mimeType === "string"
                ? resource.mimeType
                : undefined,
            text:
              typeof resource.text === "string" ? resource.text : undefined,
            blob:
              typeof resource.blob === "string" ? resource.blob : undefined,
          },
        });
        continue;
      }
    }
    blocks.push({ type: "unknown", raw: item });
  }
  return blocks;
}

function unwrapResult(response: McpTransportResponse, id: JsonRpcId): unknown {
  if (response.body == null) {
    throw new McpError("malformed", "MCP response missing JSON-RPC body", {
      status: response.status,
    });
  }

  const body = response.body;
  if (body.error) {
    const message = body.error.message || "JSON-RPC error";
    const category =
      classifyMessageText(message) ??
      (body.error.code === -32601 ? "missing_tool" : "malformed");
    throw new McpError(category, message, {
      status: response.status,
      cause: body.error,
    });
  }

  if (!("result" in body)) {
    throw new McpError("malformed", "JSON-RPC response missing result", {
      status: response.status,
    });
  }

  if (
    body.id !== undefined &&
    body.id !== null &&
    String(body.id) !== String(id)
  ) {
    throw new McpError(
      "malformed",
      `JSON-RPC response id mismatch (expected ${id}, got ${body.id})`,
      { status: response.status },
    );
  }

  return body.result;
}

function parseInitializeResult(result: unknown): McpInitializeResult {
  if (!result || typeof result !== "object") {
    throw new McpError("malformed", "initialize result is not an object");
  }
  const obj = result as Record<string, unknown>;
  if (typeof obj.protocolVersion !== "string") {
    throw new McpError(
      "malformed",
      "initialize result missing protocolVersion",
    );
  }
  const serverInfo = obj.serverInfo;
  if (!serverInfo || typeof serverInfo !== "object") {
    throw new McpError("malformed", "initialize result missing serverInfo");
  }
  const info = serverInfo as Record<string, unknown>;
  return {
    protocolVersion: obj.protocolVersion,
    capabilities:
      obj.capabilities && typeof obj.capabilities === "object"
        ? (obj.capabilities as Record<string, unknown>)
        : {},
    serverInfo: {
      ...info,
      name: typeof info.name === "string" ? info.name : "unknown",
      version: typeof info.version === "string" ? info.version : "unknown",
    },
  };
}

function parseToolsList(result: unknown): McpTool[] {
  if (!result || typeof result !== "object") {
    throw new McpError("malformed", "tools/list result is not an object");
  }
  const tools = (result as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) {
    throw new McpError("malformed", "tools/list missing tools array");
  }
  return tools
    .filter(
      (tool): tool is Record<string, unknown> =>
        !!tool && typeof tool === "object",
    )
    .map((tool) => ({
      name: typeof tool.name === "string" ? tool.name : "",
      description:
        typeof tool.description === "string" ? tool.description : undefined,
      inputSchema:
        tool.inputSchema && typeof tool.inputSchema === "object"
          ? (tool.inputSchema as Record<string, unknown>)
          : undefined,
    }))
    .filter((tool) => tool.name.length > 0);
}

function parseCallToolResult(result: unknown): McpCallToolResult {
  if (!result || typeof result !== "object") {
    throw new McpError("malformed", "tools/call result is not an object");
  }
  const obj = result as Record<string, unknown>;
  return {
    content: normalizeContentBlocks(obj.content),
    isError: obj.isError === true,
    structuredContent: obj.structuredContent,
  };
}

/**
 * Minimal MCP client: initialize, listTools, callTool over a pluggable transport.
 * Ready to call any tool by name; allowlist policy is applied by callers (Phase 8.3).
 */
export class McpClient {
  private readonly transport: McpTransport;
  private readonly clientInfo: { name: string; version: string };
  private readonly outerSignal?: AbortSignal;
  private sessionId: string | undefined;
  private protocolVersion: string | undefined;
  private initialized = false;

  constructor(options: McpClientOptions) {
    this.transport = options.transport;
    this.clientInfo = options.clientInfo ?? { ...MCP_CLIENT_INFO };
    this.outerSignal = options.signal;
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  getProtocolVersion(): string | undefined {
    return this.protocolVersion;
  }

  private sessionHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.protocolVersion) {
      headers["MCP-Protocol-Version"] = this.protocolVersion;
    }
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    return headers;
  }

  private async sendNotification(
    method: string,
    params?: unknown,
  ): Promise<void> {
    const message: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      ...(params !== undefined ? { params } : {}),
    };
    await this.transport.send({
      message,
      headers: this.sessionHeaders(),
      signal: this.outerSignal,
    });
  }

  async initialize(): Promise<McpInitializeResult> {
    const id = allocId();
    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: this.clientInfo,
      },
    };

    const response = await this.transport.send({
      message,
      // No MCP-Protocol-Version / session until negotiated.
      signal: this.outerSignal,
    });

    const sessionHeader = headerGet(response.headers, "mcp-session-id");
    if (sessionHeader) {
      this.sessionId = sessionHeader;
    }

    const result = parseInitializeResult(unwrapResult(response, id));
    this.protocolVersion = result.protocolVersion || MCP_PROTOCOL_VERSION;

    await this.sendNotification("notifications/initialized");
    this.initialized = true;
    return result;
  }

  async listTools(): Promise<McpTool[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    const id = allocId();
    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method: "tools/list",
    };
    const response = await this.transport.send({
      message,
      headers: this.sessionHeaders(),
      signal: this.outerSignal,
    });
    return parseToolsList(unwrapResult(response, id));
  }

  async callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<McpCallToolResult> {
    if (!this.initialized) {
      await this.initialize();
    }
    const id = allocId();
    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    };
    const response = await this.transport.send({
      message,
      headers: this.sessionHeaders(),
      signal: this.outerSignal,
    });

    try {
      return parseCallToolResult(unwrapResult(response, id));
    } catch (error) {
      if (
        error instanceof McpError &&
        error.category === "missing_tool"
      ) {
        throw error;
      }
      if (
        error instanceof McpError &&
        /tool/i.test(error.message) &&
        /not found|unknown|missing/i.test(error.message)
      ) {
        throw new McpError("missing_tool", error.message, {
          cause: error,
          status: error.status,
        });
      }
      throw error;
    }
  }
}

export function createMcpClient(options: McpClientOptions): McpClient {
  return new McpClient(options);
}

/** @internal exported for tests */
export function normalizeMcpContentBlocks(raw: unknown): McpContentBlock[] {
  return normalizeContentBlocks(raw);
}
