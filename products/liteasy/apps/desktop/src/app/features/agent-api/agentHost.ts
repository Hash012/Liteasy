import type { AgentPublicApi } from "./agentApi.types";
import { createAgentCliAdapter } from "./agentCliAdapter";
import { createAgentMcpJsonRpcHandler } from "./agentMcpJsonRpc";

export function createAgentHost(api: AgentPublicApi) {
  const cli = createAgentCliAdapter(api);
  const mcp = createAgentMcpJsonRpcHandler(api);

  return {
    async executeCli(
      argv: string[],
      write: (line: string) => void = () => undefined
    ) {
      const result = await cli.execute(argv);
      result.lines.forEach(write);
      return result.exitCode;
    },

    handleMcpLine(line: string) {
      return mcp.handleLine(line);
    },

    handleMcpRequest: mcp.handleRequest
  };
}
