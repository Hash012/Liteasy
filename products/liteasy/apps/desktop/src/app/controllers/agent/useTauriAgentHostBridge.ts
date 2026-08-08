import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentJsonValue, AgentPublicApi } from "../../features/agent-api/agentApi.types";
import { createAgentCliAdapter } from "../../features/agent-api/agentCliAdapter";
import { createAgentMcpJsonRpcHandler } from "../../features/agent-api/agentMcpJsonRpc";

type AgentHostRequest = {
  kind: "cli" | "mcp_line";
  payload: AgentJsonValue;
  requestId: string;
};

function isRecord(value: AgentJsonValue): value is Record<string, AgentJsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function useTauriAgentHostBridge(api: AgentPublicApi) {
  useEffect(() => {
    const cli = createAgentCliAdapter(api);
    const mcp = createAgentMcpJsonRpcHandler(api);
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<AgentHostRequest>("liteasy-agent-host-request", async ({ payload: request }) => {
      let response: AgentJsonValue;
      try {
        if (!isRecord(request.payload)) {
          throw new Error("Agent host payload must be an object");
        }
        if (request.kind === "cli") {
          const argv = request.payload.argv;
          if (!Array.isArray(argv) || !argv.every((value) => typeof value === "string")) {
            throw new Error("Agent CLI request requires a string argv array");
          }
          const result = await cli.execute(argv);
          response = { ok: true, value: result } as unknown as AgentJsonValue;
        } else if (request.kind === "mcp_line") {
          const line = request.payload.line;
          if (typeof line !== "string") {
            throw new Error("Agent MCP request requires a line string");
          }
          response = {
            ok: true,
            value: await mcp.handleLine(line)
          } as AgentJsonValue;
        } else {
          throw new Error(`Unknown Agent host request kind: ${String(request.kind)}`);
        }
      } catch (error) {
        response = {
          error: error instanceof Error ? error.message : "Agent host bridge failed",
          ok: false
        };
      }

      await invoke("agent_host_reply", {
        requestId: request.requestId,
        response
      }).catch(() => undefined);
    }).then((stopListening) => {
      if (disposed) {
        stopListening();
      } else {
        unlisten = stopListening;
      }
    }).catch(() => {
      // 浏览器/Vitest 环境没有 Tauri IPC；进程内 Agent client 仍可正常使用。
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [api]);
}
