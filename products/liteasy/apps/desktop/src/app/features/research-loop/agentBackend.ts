import type { AgentJsonValue } from "../agent-api/agentApi.types";
export type AgentBackendResult = { message: string; metadata?: AgentJsonValue };
export interface AgentBackend {
  readonly backendId: "LiteasyNative" | "CodexAppServer" | "OMPDriver";
  readonly loopOwner: "liteasy_native" | "codex_app_server" | "omp_driver";
  run(input: { taskId: string; model: string; brief: string; signal?: AbortSignal; onDelta?: (text: string) => void }): Promise<AgentBackendResult>;
}
