import { expect, test } from "vitest";
import { createCodexAppServer, type CodexMessage, type CodexTransport } from "../app/features/research-loop/codexAppServer";

function recovery(error: { code: number; message: string }) {
  let emit: (message: CodexMessage) => void = () => undefined;
  const sent: CodexMessage[] = [];
  const transport: CodexTransport = { subscribe(handler) { emit = handler; return () => undefined; }, async send(message) {
    sent.push(message);
    if (message.method === "initialize") emit({ id: message.id, result: {} });
    if (message.method === "thread/resume") emit({ id: message.id, error });
    if (message.method === "thread/start") emit({ id: message.id, result: { thread: { id: "fresh-thread" } } });
    if (message.method === "turn/start") {
      emit({ id: message.id, result: { turn: { id: "turn" } } });
      emit({ method: "turn/completed", params: { threadId: "fresh-thread", turn: { id: "turn", status: "completed" } } });
    }
  } };
  return { sent, client: createCodexAppServer(transport, [], async () => undefined, () => undefined) };
}
test("a thread created before its first turn can restart from its authorized brief when no rollout exists", async () => {
  const { client, sent } = recovery({ code: -32600, message: "no rollout found for thread id old-thread" });
  await client.initialize();
  const result = await client.start("approved-model", "固定资料和原始结果引用", "old-thread");
  expect(result.threadId).toBe("fresh-thread");
  expect(sent.filter(message => message.method === "turn/start")).toHaveLength(1);
  expect(sent.find(message => message.method === "thread/start")?.params).toMatchObject({ model: "approved-model", allowProviderModelFallback: false });
  expect(sent.find(message => message.method === "turn/start")?.params.input[0].text).toBe("固定资料和原始结果引用");
  client.dispose();
});
test("authentication or generic resume errors never silently create another execution", async () => {
  const { client, sent } = recovery({ code: -32600, message: "account authorization expired" });
  await client.initialize();
  await expect(client.start("approved-model", "goal", "old-thread")).rejects.toThrow("Codex 请求失败");
  expect(sent.some(message => message.method === "thread/start" || message.method === "turn/start")).toBe(false);
  client.dispose();
});
