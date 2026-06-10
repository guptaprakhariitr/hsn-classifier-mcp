// MCP-over-HTTP server shim (JSON-RPC 2.0)
// Open-source; reused across every Category 1 product.
//
// Implements the minimum needed for MCP clients (Claude Desktop, Cursor, Cline,
// Continue, etc.) to discover and invoke tools over HTTP. The streaming/SSE
// variants are not implemented here — every Category 1 tool returns in <1s
// so plain request/response JSON is sufficient.

export interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  handler: (args: any, ctx: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  env: Record<string, any>;
  apiKey: string | null;
  tier: "free" | "solo" | "team" | "pro";
  callsRemaining: number;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

const PROTOCOL_VERSION = "2025-06-18";

export class McpServer {
  private tools = new Map<string, Tool>();
  private serverInfo: { name: string; version: string };

  constructor(info: { name: string; version: string }) {
    this.serverInfo = info;
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  async handle(req: JsonRpcRequest, ctx: ToolContext): Promise<JsonRpcResponse | null> {
    const id = req.id ?? null;

    try {
      switch (req.method) {
        case "initialize":
          return {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: { tools: { listChanged: false } },
              serverInfo: this.serverInfo,
            },
          };

        case "notifications/initialized":
          // Notification = no response (id is absent).
          return null;

        case "tools/list":
          return {
            jsonrpc: "2.0",
            id,
            result: {
              tools: Array.from(this.tools.values()).map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
              })),
            },
          };

        case "tools/call": {
          const { name, arguments: args } = req.params ?? {};
          const tool = this.tools.get(name);
          if (!tool) {
            return rpcError(id, -32601, `Tool not found: ${name}`);
          }

          const result = await tool.handler(args ?? {}, ctx);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
                },
              ],
              isError: false,
            },
          };
        }

        case "ping":
          return { jsonrpc: "2.0", id, result: {} };

        default:
          return rpcError(id, -32601, `Method not found: ${req.method}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return rpcError(id, -32603, message);
    }
  }
}

function rpcError(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export function isJsonRpcRequest(body: unknown): body is JsonRpcRequest {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as any).jsonrpc === "2.0" &&
    typeof (body as any).method === "string"
  );
}
