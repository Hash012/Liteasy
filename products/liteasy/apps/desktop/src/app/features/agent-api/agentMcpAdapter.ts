import type { AgentApiResult, AgentJsonValue, AgentPublicApi } from "./agentApi.types";

export type McpToolDefinition = {
  description: string;
  inputSchema: AgentJsonValue;
  name: string;
};

export type McpToolResult = {
  content: Array<{ text: string; type: "text" }>;
  isError?: boolean;
  structuredContent: Record<string, AgentJsonValue>;
};

export type McpResourceDefinition = {
  description: string;
  mimeType: "application/json";
  name: string;
  uri: string;
};

export type McpResourceTemplateDefinition = {
  description: string;
  mimeType: "application/json";
  name: string;
  uriTemplate: string;
};

const toolDefinitions: McpToolDefinition[] = [
  {
    description: "Create an explicit Liteasy Agent session handle.",
    inputSchema: {
      properties: {
        clientSessionId: { type: "string" },
        principalId: { type: "string" }
      },
      type: "object"
    },
    name: "liteasy_agent_session_create"
  },
  {
    description: "Submit a knowledge or command turn to a Liteasy Agent session.",
    inputSchema: {
      properties: {
        idempotencyKey: { type: "string" },
        message: { type: "string" },
        mode: { enum: ["command", "explain", "qa"], type: "string" },
        sessionId: { type: "string" }
      },
      required: ["idempotencyKey", "message", "mode", "sessionId"],
      type: "object"
    },
    name: "liteasy_agent_turn"
  },
  {
    description: "Approve or reject a pending Liteasy Agent confirmation.",
    inputSchema: {
      properties: {
        confirmationId: { type: "string" },
        decision: { enum: ["approve", "reject"], type: "string" },
        sessionId: { type: "string" }
      },
      required: ["confirmationId", "decision", "sessionId"],
      type: "object"
    },
    name: "liteasy_agent_confirm"
  },
  {
    description: "Read the current state and event history of an Agent run.",
    inputSchema: {
      properties: {
        runId: { type: "string" },
        sessionId: { type: "string" }
      },
      required: ["runId", "sessionId"],
      type: "object"
    },
    name: "liteasy_agent_run_get"
  },
  {
    description: "Cancel an Agent run and propagate cancellation to its executor.",
    inputSchema: {
      properties: {
        reason: { type: "string" },
        runId: { type: "string" },
        sessionId: { type: "string" }
      },
      required: ["runId", "sessionId"],
      type: "object"
    },
    name: "liteasy_agent_run_cancel"
  }
];

function asJsonValue(value: unknown): AgentJsonValue {
  return JSON.parse(JSON.stringify(value)) as AgentJsonValue;
}

function toolResult<T>(result: AgentApiResult<T>): McpToolResult {
  const structuredContent: Record<string, AgentJsonValue> = result.ok
    ? { result: asJsonValue(result.data) }
    : { error: asJsonValue(result.error) };
  return {
    content: [{ text: JSON.stringify(structuredContent), type: "text" }],
    isError: result.ok ? undefined : true,
    structuredContent
  };
}

function requiredString(argumentsValue: Record<string, unknown>, name: string) {
  const value = argumentsValue[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid MCP tool argument: ${name} must be a non-empty string`);
  }
  return value;
}

export function createAgentMcpAdapter(api: AgentPublicApi) {
  return {
    async callTool(name: string, argumentsValue: Record<string, unknown>): Promise<McpToolResult> {
      switch (name) {
        case "liteasy_agent_session_create":
          return toolResult(
            await api.createSession({
              clientSessionId:
                typeof argumentsValue.clientSessionId === "string"
                  ? argumentsValue.clientSessionId
                  : undefined,
              consumer: "mcp",
              principalId:
                typeof argumentsValue.principalId === "string"
                  ? argumentsValue.principalId
                  : undefined
            })
          );
        case "liteasy_agent_turn": {
          const mode = requiredString(argumentsValue, "mode");
          if (mode !== "command" && mode !== "explain" && mode !== "qa") {
            throw new Error(`Invalid MCP tool argument: unsupported mode ${mode}`);
          }
          return toolResult(
            await api.submitTurn({
              idempotencyKey: requiredString(argumentsValue, "idempotencyKey"),
              input: {
                message: requiredString(argumentsValue, "message"),
                mode
              },
              sessionId: requiredString(argumentsValue, "sessionId")
            })
          );
        }
        case "liteasy_agent_confirm": {
          const decision = requiredString(argumentsValue, "decision");
          if (decision !== "approve" && decision !== "reject") {
            throw new Error(`Invalid MCP tool argument: unsupported decision ${decision}`);
          }
          return toolResult(
            await api.resolveConfirmation({
              confirmationId: requiredString(argumentsValue, "confirmationId"),
              decision,
              sessionId: requiredString(argumentsValue, "sessionId")
            })
          );
        }
        case "liteasy_agent_run_get":
          return toolResult(
            await api.getRun({
              runId: requiredString(argumentsValue, "runId"),
              sessionId: requiredString(argumentsValue, "sessionId")
            })
          );
        case "liteasy_agent_run_cancel":
          return toolResult(
            await api.cancelRun({
              reason:
                typeof argumentsValue.reason === "string" ? argumentsValue.reason : undefined,
              runId: requiredString(argumentsValue, "runId"),
              sessionId: requiredString(argumentsValue, "sessionId")
            })
          );
        default:
          throw new Error(`Unknown MCP tool: ${name}`);
      }
    },

    listResources(): McpResourceDefinition[] {
      return [
        {
          description: "Sanitized capabilities exposed by the Liteasy Agent host.",
          mimeType: "application/json",
          name: "Liteasy Agent capabilities",
          uri: "liteasy://agent/capabilities"
        }
      ];
    },

    listResourceTemplates(): McpResourceTemplateDefinition[] {
      return [
        {
          description: "Read one Agent run from its owning explicit session.",
          mimeType: "application/json",
          name: "Liteasy Agent run",
          uriTemplate: "liteasy://agent/sessions/{sessionId}/runs/{runId}"
        }
      ];
    },

    listTools(): McpToolDefinition[] {
      return toolDefinitions.map((tool) => ({ ...tool }));
    },

    async readResource(uri: string) {
      if (uri === "liteasy://agent/capabilities") {
        const result = await api.listCapabilities();
        if (!result.ok) {
          throw new Error(result.error.message);
        }
        return {
          contents: [
            {
              mimeType: "application/json" as const,
              text: JSON.stringify(result.data),
              uri
            }
          ]
        };
      }

      const match = /^liteasy:\/\/agent\/sessions\/([^/]+)\/runs\/([^/]+)$/.exec(uri);
      if (!match) {
        throw new Error(`Unknown MCP resource: ${uri}`);
      }
      const result = await api.getRun({
        runId: decodeURIComponent(match[2]),
        sessionId: decodeURIComponent(match[1])
      });
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return {
        contents: [
          {
            mimeType: "application/json" as const,
            text: JSON.stringify(result.data),
            uri
          }
        ]
      };
    }
  };
}
