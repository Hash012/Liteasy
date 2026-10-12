import { expect, test } from "vitest";
import { createCodexAppServer, type CodexMessage, type CodexTransport } from "../app/features/research-loop/codexAppServer";

function server(status: "completed" | "failed" | "incomplete" = "completed") {
  let handler: (message: CodexMessage) => void = () => undefined;
  const sent: CodexMessage[] = [];
  const transport: CodexTransport = {
    subscribe(value) { handler = value; return () => { handler = () => undefined; }; },
    async send(message) {
      sent.push(message);
      if (message.method === "initialize") handler({ id: message.id, result: {} });
      if (message.method === "thread/start") handler({ id: message.id, result: { thread: { id: "thread" } } });
      if (message.method === "turn/start") {
        handler({ id: message.id, result: { turn: { id: "turn" } } });
        handler({ id: "actual-tool-request", method: "item/tool/call", params: { threadId: "thread", turnId: "turn", tool: "read_source", arguments: { revision: "pinned" } } });
      }
      if (message.id === "actual-tool-request") {
        handler({ method: "item/agentMessage/delta", params: { threadId: "thread", turnId: "turn", delta: "已读取实际结果。" } });
        handler({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status } } });
      }
    },
  };
  return { transport, sent, emit: (value: CodexMessage) => handler(value) };
}
test("Codex owns the sole loop and receives the real domain result through native tool replies", async () => {
  const fixture = server();
  const calls: unknown[] = [], deltas: string[] = [];
  const client = createCodexAppServer(fixture.transport, [{ type: "function", name: "read_source", description: "read", inputSchema: {} }],
    async (_, args) => { calls.push(args); return { text: "ACTUAL_SOURCE_SENTINEL", revision: "pinned" }; }, delta => deltas.push(delta));
  await client.initialize();
  const result = await client.start("account-selected-slug", "问题");
  expect(result.loopOwner).toBe("codex_app_server");
  expect(result.toolCalls).toBe(1);
  expect(calls).toEqual([{ revision: "pinned" }]);
  expect(JSON.stringify(fixture.sent.find(message => message.id === "actual-tool-request"))).toContain("ACTUAL_SOURCE_SENTINEL");
  expect(deltas.join("")).toBe("已读取实际结果。");
  expect(fixture.sent.filter(message => message.method === "turn/start")).toHaveLength(1);
  client.dispose();
});
test.each(["failed", "incomplete"] as const)("streamed prose followed by %s is not success", async status => {
  const fixture = server(status), client = createCodexAppServer(fixture.transport,
    [{ type: "function", name: "read_source", description: "read", inputSchema: {} }], async () => ({}), () => undefined);
  await client.initialize();
  await expect(client.start("selected", "goal")).rejects.toThrow("未完成");
  client.dispose();
});
test("document-injected shell and permission requests cannot self-authorize", async () => {
  const fixture = server(), client = createCodexAppServer(fixture.transport, [], async () => { throw new Error("never"); }, () => undefined);
  await client.initialize();
  fixture.emit({ id: "permissions", method: "item/permissions/requestApproval", params: { permissions: { network: { enabled: true } } } });
  await Promise.resolve();
  expect(fixture.sent.find(message => message.id === "permissions")?.result).toEqual({ permissions: {}, scope: "turn" });
  fixture.emit({ id: "shell", method: "item/commandExecution/requestApproval", params: { command: "read credentials" } });
  await Promise.resolve();
  expect(fixture.sent.find(message => message.id === "shell")?.result).toEqual({ decision: "decline" });
  client.dispose();
});

test("exhausting the domain tool budget rejects the turn even if text could continue", async () => {
  let handler: (message: CodexMessage) => void = () => undefined;
  let calls = 0;
  const transport: CodexTransport = { subscribe(value) { handler = value; return () => undefined; }, async send(message) {
    if (message.method === "initialize") handler({ id: message.id, result: {} });
    if (message.method === "thread/start") handler({ id: message.id, result: { thread: { id: "thread" } } });
    if (message.method === "turn/start") {
      handler({ id: message.id, result: { turn: { id: "turn" } } });
      for (let i = 0; i < 25; i++) handler({ id: "tool-" + i, method: "item/tool/call", params: { threadId: "thread", turnId: "turn", tool: "read", arguments: {} } });
    }
  } };
  const client = createCodexAppServer(transport, [{ type: "function", name: "read", description: "read", inputSchema: {} }], async () => { calls++; return {}; }, () => undefined);
  await client.initialize();
  await expect(client.start("model", "goal")).rejects.toThrow("预算");
  expect(calls).toBe(24);
  client.dispose();
});

function controlledServer() {
  let emit: (message: CodexMessage) => void = () => undefined;
  const sent: CodexMessage[] = [];
  const transport: CodexTransport = { subscribe(handler) { emit = handler; return () => undefined; }, async send(message) {
    sent.push(message);
    if (message.method === "initialize") emit({ id: message.id, result: {} });
    if (message.method === "thread/start" || message.method === "thread/resume") emit({ id: message.id, result: { thread: { id: "thread" } } });
    if (message.method === "turn/start") emit({ id: message.id, result: { turn: { id: "turn" } } });
  } };
  return { transport, sent, emit: (message: CodexMessage) => emit(message), async ready() { for (let i = 0; i < 5; i++) await Promise.resolve(); } };
}
test("duplicate tool delivery reuses its receipt; stale and late turns cannot mutate a project", async () => {
  const fixture = controlledServer(), calls: string[] = [];
  const client = createCodexAppServer(fixture.transport, [{ type: "function", name: "draft", description: "save", inputSchema: {} }],
    async () => { calls.push("saved once"); return { id: "real-draft" }; }, () => undefined);
  await client.initialize();
  const done = client.start("chosen", "goal"); await fixture.ready();
  const request = { id: "write-1", method: "item/tool/call", params: { threadId: "thread", turnId: "turn", tool: "draft", arguments: {} } };
  fixture.emit(request); fixture.emit(request);
  fixture.emit({ ...request, id: "stale", params: { ...request.params, turnId: "old-turn" } });
  fixture.emit({ method: "turn/completed", params: { threadId: "thread", turn: { id: "old-turn", status: "completed" } } });
  await fixture.ready();
  expect(calls).toHaveLength(1);
  expect(fixture.sent.filter(message => message.id === "write-1")).toHaveLength(2);
  fixture.emit({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "completed" } } });
  await done;
  fixture.emit({ ...request, id: "late" }); await fixture.ready();
  expect(calls).toHaveLength(1);
  expect(fixture.sent.find(message => message.id === "late")?.result.success).toBe(false);
  client.dispose();
});
test("resuming uses the saved thread without sending unsupported thread-start fields", async () => {
  const fixture = controlledServer(), client = createCodexAppServer(fixture.transport, [], async () => undefined, () => undefined);
  await client.initialize();
  const done = client.start("chosen", "goal", "thread"); await fixture.ready();
  const resume = fixture.sent.find(message => message.method === "thread/resume")!;
  expect(resume.params.threadId).toBe("thread");
  expect(resume.params).not.toHaveProperty("dynamicTools");
  expect(resume.params).not.toHaveProperty("allowProviderModelFallback");
  fixture.emit({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "completed" } } });
  await done; client.dispose();
});
test("cancellation interrupts the bound turn and rejects late writes even after text", async () => {
  const fixture = controlledServer(), abort = new AbortController(), deltas: string[] = [];
  let writes = 0;
  const client = createCodexAppServer(fixture.transport, [{ type: "function", name: "draft", description: "save", inputSchema: {} }],
    async () => { writes++; }, value => deltas.push(value), abort.signal);
  await client.initialize();
  const done = client.start("chosen", "goal"); const rejected = expect(done).rejects.toThrow("取消"); await fixture.ready();
  fixture.emit({ method: "item/agentMessage/delta", params: { threadId: "thread", turnId: "turn", delta: "未完成的回答" } });
  abort.abort();
  fixture.emit({ id: "late", method: "item/tool/call", params: { threadId: "thread", turnId: "turn", tool: "draft", arguments: {} } });
  await rejected;
  expect(deltas).toEqual(["未完成的回答"]); expect(writes).toBe(0);
  expect(fixture.sent.find(message => message.method === "turn/interrupt")?.params).toEqual({ threadId: "thread", turnId: "turn" });
  client.dispose();
});
