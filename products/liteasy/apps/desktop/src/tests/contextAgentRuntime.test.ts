import { afterEach, expect, test, vi } from "vitest";
import { runWorkspaceAgent } from "../app/controllers/agent/runWorkspaceAgent";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { createContextAgentTools } from "../app/features/context-cloud/contextAgentTools";
import { clearStoredAccountSession, storeAccountSession } from "../app/features/account/accountSessionStorage";
const model = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("../app/features/models/modelRuntime", () => ({ createModelGatewayFromSettings: () => ({ generateAnswer: model.generate }) }));
const action = (name: string, text = "", message = "") => ({ action: name, text, message, query: "", path: "", expectedRevision: "", mode: "append", offset: 0 });
afterEach(() => { clearStoredAccountSession(); vi.restoreAllMocks(); });
test("the existing workspace model loop calls the same Context client and sees its actual receipt", async () => {
  storeAccountSession({ endpoint: "https://api.example.invalid", issuer: "https://id.example.invalid", userId: "alice", sessionId: "token", name: "A", email: "a@example.invalid", expiresAt: "2030-01-01T00:00:00Z" });
  const write = { schemaVersion: "liteasy.context-write/v1", action: "create", operationId: crypto.randomUUID(), entry: { scopeKey: "personal", kind: "progress", title: "本轮进展", bodyMarkdown: "已完成基准，误差待解释，下一步为计划。", basis: "agent_summary" } };
  const receipt = { entryId: "11111111-1111-4111-8111-000000000001", operationId: write.operationId, revision: 1 };
  const client = { write: vi.fn(async () => receipt) };
  const request = "$liteasy-capture 保存本轮进展";
  model.generate.mockReset().mockResolvedValueOnce({ answer: JSON.stringify(action("context_write", JSON.stringify(write))) })
    .mockImplementationOnce(async ({ prompt }: { prompt: string }) => { expect(prompt).toContain(receipt.entryId); return { answer: JSON.stringify(action("answer", "", "已保存本轮进展，版本 1。")) }; });
  const result = await runWorkspaceAgent({ runId: "context-runtime", request: { input: { message: request } }, context: {}, conversationHistory: [], signal: new AbortController().signal, reportManagerActivity: vi.fn() } as never,
    { assets: {}, assetScopeId: "local", contextTools: createContextAgentTools(request, (() => client) as never), knowledge: { selectedPapers: [], settings: createSettingsStore().getState() } } as never);
  expect(result.message).toContain("已保存"); expect(client.write).toHaveBeenCalledExactlyOnceWith(write);
});
