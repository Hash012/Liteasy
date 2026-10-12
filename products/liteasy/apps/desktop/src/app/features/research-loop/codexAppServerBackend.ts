import type { AgentBackend } from "./agentBackend";
import { createCodexAppServer, type CodexTool, type CodexTransport } from "./codexAppServer";

/** AgentPublicApi supplies the lifecycle; this adapter delegates its single loop to Codex. */
export function createCodexAppServerBackend(input: { transport: CodexTransport; tools: CodexTool[];
  callTool(name: string, arguments_: unknown): Promise<unknown>; signal?: AbortSignal; onDelta(text: string): void }) {
  const client = createCodexAppServer(input.transport, input.tools, input.callTool, input.onDelta, input.signal);
  const backend = {
    backendId: "CodexAppServer" as const, loopOwner: "codex_app_server" as const,
    async run(request: Parameters<AgentBackend["run"]>[0] & { resumedThread?: string }) {
      request.signal?.throwIfAborted();
      await client.initialize();
      return client.start(request.model, request.brief, request.resumedThread);
    },
    dispose: client.dispose,
  } satisfies AgentBackend & { dispose(): void };
  return backend;
}
