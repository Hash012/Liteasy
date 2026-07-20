import type { AgentJsonValue, AgentPublicApi } from "./agentApi.types";
import { createAgentMcpAdapter } from "./agentMcpAdapter";

export const LITEASY_MCP_PROTOCOL_VERSION = "2025-06-18";

export type McpJsonRpcRequest = {
  id?: number | string | null;
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
};

export type McpJsonRpcResponse = {
  error?: {
    code: number;
    data?: AgentJsonValue;
    message: string;
  };
  id: number | string | null;
  jsonrpc: "2.0";
  result?: AgentJsonValue;
};

function response(id: McpJsonRpcResponse["id"], result: AgentJsonValue): McpJsonRpcResponse {
  return { id, jsonrpc: "2.0", result };
}

function errorResponse(
  id: McpJsonRpcResponse["id"],
  code: number,
  message: string
): McpJsonRpcResponse {
  return {
    error: { code, message },
    id,
    jsonrpc: "2.0"
  };
}

function isJsonRpcRequest(value: unknown): value is McpJsonRpcRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "jsonrpc" in value &&
    value.jsonrpc === "2.0" &&
    "method" in value &&
    typeof value.method === "string"
  );
}

export function createAgentMcpJsonRpcHandler(api: AgentPublicApi) {
  const adapter = createAgentMcpAdapter(api);

  const handleRequest = async (
    request: McpJsonRpcRequest
  ): Promise<McpJsonRpcResponse | null> => {
    const id = request.id ?? null;
    const isNotification = request.id === undefined;

    try {
      switch (request.method) {
        case "initialize":
          return response(id, {
            capabilities: {
              resources: {},
              tools: {}
            },
            protocolVersion: LITEASY_MCP_PROTOCOL_VERSION,
            serverInfo: {
              name: "liteasy-agent",
              version: "0.1.0"
            }
          });
        case "notifications/initialized":
          return null;
        case "ping":
          return response(id, {});
        case "tools/list":
          return response(id, { tools: adapter.listTools() } as unknown as AgentJsonValue);
        case "tools/call": {
          const name = request.params?.name;
          if (typeof name !== "string") {
            return errorResponse(id, -32602, "tools/call requires params.name");
          }
          const argumentsValue = request.params?.arguments;
          if (
            argumentsValue !== undefined &&
            (typeof argumentsValue !== "object" ||
              argumentsValue === null ||
              Array.isArray(argumentsValue))
          ) {
            return errorResponse(id, -32602, "tools/call params.arguments must be an object");
          }
          const result = await adapter.callTool(
            name,
            (argumentsValue ?? {}) as Record<string, unknown>
          );
          return response(id, result as unknown as AgentJsonValue);
        }
        case "resources/list":
          return response(
            id,
            { resources: adapter.listResources() } as unknown as AgentJsonValue
          );
        case "resources/templates/list":
          return response(
            id,
            { resourceTemplates: adapter.listResourceTemplates() } as unknown as AgentJsonValue
          );
        case "resources/read": {
          const uri = request.params?.uri;
          if (typeof uri !== "string") {
            return errorResponse(id, -32602, "resources/read requires params.uri");
          }
          const result = await adapter.readResource(uri);
          return response(id, result as unknown as AgentJsonValue);
        }
        default:
          if (isNotification) {
            return null;
          }
          return errorResponse(id, -32601, `Method not found: ${request.method}`);
      }
    } catch (error) {
      if (isNotification) {
        return null;
      }
      return errorResponse(
        id,
        -32602,
        error instanceof Error ? error.message : "Invalid MCP request"
      );
    }
  };

  return {
    handleRequest,

    async handleLine(line: string): Promise<string | null> {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        return JSON.stringify(errorResponse(null, -32700, "Parse error"));
      }
      if (!isJsonRpcRequest(value)) {
        return JSON.stringify(errorResponse(null, -32600, "Invalid Request"));
      }
      const result = await handleRequest(value);
      return result ? JSON.stringify(result) : null;
    }
  };
}
