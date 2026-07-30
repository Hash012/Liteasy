import { createAgentApplicationService } from "../app/controllers/agent/agentApplicationService";
import { createAgentCliAdapter } from "../app/features/agent-api/agentCliAdapter";
import { createAgentMcpAdapter } from "../app/features/agent-api/agentMcpAdapter";
import { createFrontendAgentClient } from "../app/features/agent-api/frontendAgentClient";
import { createAgentHost } from "../app/features/agent-api/agentHost";

function createApi() {
  let sequence = 0;
  return createAgentApplicationService({
    createId(prefix) {
      sequence += 1;
      return `${prefix}-${sequence}`;
    },
    executeCommand: () => ({
      events: [{ message: "command complete", type: "assistant_reply" }],
      settingsChanged: false
    }),
    executeKnowledge: ({ request }) => ({ message: `answer: ${request.input.message}` }),
    now: () => new Date("2026-07-19T00:00:00.000Z")
  });
}

test("frontend client creates a session and forwards stable events", async () => {
  const client = createFrontendAgentClient(createApi(), { clientSessionId: "main-window" });
  const eventTypes: string[] = [];
  client.subscribe((event) => eventTypes.push(event.type));

  const result = await client.send({ message: "what changed?", mode: "qa" });

  expect(result).toMatchObject({ data: { status: "completed" }, ok: true });
  expect(client.getSession()).toMatchObject({
    clientSessionId: "main-window",
    consumer: "frontend",
    status: "active"
  });
  expect(eventTypes).toEqual([
    "run.started",
    "context.prepared",
    "assistant.message",
    "run.completed"
  ]);
});

test("frontend clients created for different conversations retain separate public sessions", async () => {
  const client = createFrontendAgentClient(createApi());
  const firstConversation = client.createSessionClient("assistant-pane:conversation-one");
  const secondConversation = client.createSessionClient("assistant-pane:conversation-two");

  await firstConversation.send({ message: "first question", mode: "qa" });
  await secondConversation.send({ message: "second question", mode: "qa" });
  await firstConversation.send({ message: "first follow-up", mode: "qa" });

  expect(firstConversation.getSession()).toMatchObject({
    clientSessionId: "assistant-pane:conversation-one",
    status: "active"
  });
  expect(secondConversation.getSession()).toMatchObject({
    clientSessionId: "assistant-pane:conversation-two",
    status: "active"
  });
  expect(firstConversation.getSession()?.sessionId).not.toBe(secondConversation.getSession()?.sessionId);
});

test("CLI adapter emits JSONL events followed by the run snapshot", async () => {
  const api = createApi();
  const cli = createAgentCliAdapter(api);
  const created = await cli.execute(["session", "create", "terminal"]);
  const session = JSON.parse(created.lines[0]);

  const result = await cli.execute([
    "turn",
    session.sessionId,
    "qa",
    "cli-question-1",
    "compare",
    "papers"
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.lines.map((value) => JSON.parse(value).type).filter(Boolean)).toEqual([
    "run.started",
    "context.prepared",
    "assistant.message",
    "run.completed"
  ]);
  expect(JSON.parse(result.lines.at(-1)!).status).toBe("completed");
});

test("MCP adapter exposes explicit session tools and readable run resources", async () => {
  const mcp = createAgentMcpAdapter(createApi());
  expect(mcp.listTools().map((tool) => tool.name)).toContain("liteasy_agent_turn");

  const created = await mcp.callTool("liteasy_agent_session_create", {});
  const session = created.structuredContent.result as { sessionId: string };
  const turn = await mcp.callTool("liteasy_agent_turn", {
    idempotencyKey: "mcp-question-1",
    message: "compare papers",
    mode: "qa",
    sessionId: session.sessionId
  });
  const run = turn.structuredContent.result as { runId: string; status: string };

  expect(run.status).toBe("completed");
  expect(turn.content[0].text).toContain(run.runId);
  const resource = await mcp.readResource(
    `liteasy://agent/sessions/${session.sessionId}/runs/${run.runId}`
  );
  expect(JSON.parse(resource.contents[0].text)).toMatchObject({
    runId: run.runId,
    status: "completed"
  });
});

test("Agent host handles MCP JSON-RPC initialization, calls, and protocol errors", async () => {
  const host = createAgentHost(createApi());
  const initialized = JSON.parse(
    (await host.handleMcpLine(
      JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: { protocolVersion: "2025-06-18" }
      })
    ))!
  );
  expect(initialized.result).toMatchObject({
    protocolVersion: "2025-06-18",
    serverInfo: { name: "liteasy-agent" }
  });

  const created = JSON.parse(
    (await host.handleMcpLine(
      JSON.stringify({
        id: 2,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          arguments: {},
          name: "liteasy_agent_session_create"
        }
      })
    ))!
  );
  expect(created.result.structuredContent.result.consumer).toBe("mcp");

  const unknown = JSON.parse(
    (await host.handleMcpLine(
      JSON.stringify({ id: 3, jsonrpc: "2.0", method: "unknown/method" })
    ))!
  );
  expect(unknown.error.code).toBe(-32601);
  expect(JSON.parse((await host.handleMcpLine("not-json"))!).error.code).toBe(-32700);
});
