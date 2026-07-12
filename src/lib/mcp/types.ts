export const MCP_PROTOCOL_VERSION = "2025-06-18";

export const MCP_CLIENT_INFO = {
  name: "hackathon-approval-agent",
  version: "0.1.0",
} as const;

export type JsonRpcId = string | number;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

export type JsonRpcErrorObject = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id?: JsonRpcId | null;
  result?: unknown;
  error?: JsonRpcErrorObject;
};

export type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | {
      type: "resource";
      resource: {
        uri: string;
        mimeType?: string;
        text?: string;
        blob?: string;
      };
    }
  | { type: "unknown"; raw: unknown };

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type McpInitializeResult = {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: {
    name: string;
    version: string;
    [key: string]: unknown;
  };
};

export type McpCallToolResult = {
  content: McpContentBlock[];
  isError?: boolean;
  structuredContent?: unknown;
};

export type McpTransportRequest = {
  message: JsonRpcRequest | JsonRpcNotification;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export type McpTransportResponse = {
  status: number;
  headers: Record<string, string>;
  /** Parsed JSON-RPC body, or null for empty/202 responses. */
  body: JsonRpcResponse | null;
};

/**
 * Pluggable transport. Unit tests inject a fake; production uses Streamable HTTP.
 */
export interface McpTransport {
  send(request: McpTransportRequest): Promise<McpTransportResponse>;
}

export type McpClientOptions = {
  transport: McpTransport;
  clientInfo?: { name: string; version: string };
  /** Optional outer abort; combined with per-request signals. */
  signal?: AbortSignal;
};
