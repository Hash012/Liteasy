import { expect, test, vi } from "vitest";
import { createDesktopAgentService, type DesktopAgentEnvironment } from "../app/controllers/agent/createDesktopAgentService";
import type { AgentStateSnapshot, AgentStateStore } from "../app/controllers/agent/agentStatePersistence";
import type { AgentEvent, SubmitAgentTurnRequest } from "../app/features/agent-api/agentApi.types";
import { contextTokens } from "../app/features/context/contextSelection";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { createAgentAssetService, readAgentAssetText } from "../app/features/resource-filesystem/agentAssetService";
import { liteasyPath } from "../app/features/resource-filesystem/liteasyPath";
import type { AgentAsset, AgentAssetReadOptions, AgentAssetWriteOptions } from "../app/features/resource-filesystem/agentAsset.types";

const notePath = liteasyPath("local", { kind: "object", ref: { objectId: "safety-note", revision: "v1" } });
const paperPath = liteasyPath("local", { kind: "paper", paperId: "safety-paper" });
const note: AgentAsset = { path: notePath, title: "Safety note", kind: "content.note", revision: "v1", capabilities: ["read", "write", "search", "add_context"] };
const paper: AgentAsset = { path: paperPath, title: "Original paper", kind: "source.document", revision: "v1", capabilities: ["read", "search", "add_context"] };
const action = (value: Record<string, unknown>) => JSON.stringify({ action: "answer", message: "", query: "", path: "", text: "", expectedRevision: "", mode: "append", offset: 0, ...value });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(responses: string[], options: {
  afterCommit?: () => Promise<void>;
  contextWindow?: string;
  searchRows?: AgentAsset[];
} = {}) {
  let text = "# Safety note";
  let revision = "v1";
  let persisted: AgentStateSnapshot | undefined;
  const store: AgentStateStore = {
    load: () => persisted,
    save: (snapshot) => { persisted = JSON.parse(JSON.stringify(snapshot)) as AgentStateSnapshot; }
  };
  const stat = vi.fn(async (path: string): Promise<AgentAsset> => {
    if (path === notePath) return { ...note, revision };
    if (path === paperPath) return paper;
    throw new Error("No such asset");
  });
  const read = vi.fn(async (path: string, input: AgentAssetReadOptions) => readAgentAssetText(await stat(path), path === notePath ? text : "Immutable original paper text.", input));
  const write = vi.fn(async (_path: string, input: AgentAssetWriteOptions) => {
    const previousRevision = revision;
    text = input.mode === "replace" ? input.text : text + input.text;
    revision = "v2";
    // A real filesystem/storage commit cannot be rolled back by an AbortSignal arriving later.
    await options.afterCommit?.();
    return { asset: { ...note, revision }, previousRevision, changed: true, addedLines: 1, removedLines: 0 };
  });
  const search = vi.fn(async () => options.searchRows ?? [note, paper]);
  const assets = createAgentAssetService({ scopeId: "local", active: () => true, adapters: [{
    id: "safety-assets", accepts: () => true, stat, read, write, search
  }] });
  const requests: Array<{ prompt: string; maxOutputTokens?: number }> = [];
  const environment: DesktopAgentEnvironment = {
    assets, assetScopeId: "local", runtime: {} as never,
    knowledge: {
      selectedPapers: [{ id: "safety-paper", title: paper.title }], importedChunksByPaperId: {},
      settings: { ...createSettingsStore().getState(), "assistant.context_window": options.contextWindow ?? "32768" },
      modelTransport: async (request) => {
        requests.push(JSON.parse(request.body));
        const answer = responses.shift();
        if (answer === undefined) throw new Error("Unexpected extra model request");
        return { ok: true, status: 200, json: async () => ({ answer, execution: { backend: "http_service", mode: "live", provider: "openai" } }) };
      }
    }
  };
  const createApi = () => createDesktopAgentService({
    getEnvironment: () => environment,
    stateStore: store,
    resolveObjectContext: async () => { throw new Error("Asset metadata must not trigger eager snapshot reads"); },
    managerAgent: { run: async (input) => ({ kind: "knowledge", result: await input.answerNormally() }) }
  });
  const api = createApi();
  const requestFor = (sessionId: string, message: string): SubmitAgentTurnRequest => ({
    sessionId, idempotencyKey: crypto.randomUUID(), input: { message, mode: "qa" },
    contextRefs: [{ objectId: "safety-note", revision: "v1" }]
  });
  const submit = async (message: string) => {
    const session = await api.createSession({ consumer: "frontend" });
    if (!session.ok) throw new Error(session.error.message);
    const result = await api.submitTurn(requestFor(session.data.sessionId, message));
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  };
  return { api, createApi, requestFor, submit, requests, stat, read, write, search, getText: () => text, getPersisted: () => persisted };
}

test("a committed write stays visible and survives restart when cancellation precedes its receipt", async () => {
  const committed = deferred();
  const returnReceipt = deferred();
  const fixture = setup([
    action({ action: "read", path: notePath }),
    action({ action: "write", path: notePath, expectedRevision: "v1", text: "\nSaved before cancellation." })
  ], { afterCommit: async () => { committed.resolve(); await returnReceipt.promise; } });
  const session = await fixture.api.createSession({ consumer: "frontend" });
  if (!session.ok) throw new Error(session.error.message);
  const events: AgentEvent[] = [];
  const unsubscribe = fixture.api.subscribe(session.data.sessionId, (event) => events.push(event));
  const pending = fixture.api.submitTurn(fixture.requestFor(session.data.sessionId, "更新这份笔记"));
  await committed.promise;
  expect(fixture.getText()).toContain("Saved before cancellation.");
  const started = events.find((event) => event.type === "run.started")!;
  const cancelled = await fixture.api.cancelRun({ sessionId: started.sessionId, runId: started.runId, reason: "user cancelled" });
  expect(cancelled.ok).toBe(true);
  returnReceipt.resolve();
  const result = await pending;
  if (!result.ok) throw new Error(result.error.message);
  expect(result.data.status).toBe("cancelled");
  const saved = expect.objectContaining({ type: "asset.written", receipt: expect.objectContaining({
    previousRevision: "v1", changed: true, asset: expect.objectContaining({ path: notePath, revision: "v2" })
  }) });
  expect(events).toContainEqual(saved);
  expect(result.data.events).toContainEqual(saved);
  expect(fixture.getPersisted()?.sessions.flatMap((item) => item.runs).find((run) => run.runId === started.runId)?.events).toContainEqual(saved);
  expect(fixture.requests).toHaveLength(2);
  expect(fixture.write).toHaveBeenCalledOnce();
  unsubscribe();
  fixture.api.dispose();
  const restored = fixture.createApi();
  const restoredRun = await restored.getRun({ sessionId: started.sessionId, runId: started.runId });
  expect(restoredRun).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ status: "cancelled", events: expect.arrayContaining([saved]) }) }));
  restored.dispose();
});

test("an oversized initial request stops before sending an over-budget model request", async () => {
  const fixture = setup([], { contextWindow: "4096" });
  const run = await fixture.submit(`请解释：${"字".repeat(5000)}`);
  expect(run.status).toBe("completed");
  expect(fixture.requests).toEqual([]);
  expect(fixture.read).not.toHaveBeenCalled();
  expect(fixture.write).not.toHaveBeenCalled();
  expect(run.events).toContainEqual(expect.objectContaining({ type: "assistant.message", message: expect.stringContaining("上下文预算") }));
  fixture.api.dispose();
});

test("oversized discovery metadata cannot make the next model request exceed the context budget", async () => {
  const fixture = setup([action({ action: "search", query: "notes" })], { contextWindow: "4096",
    searchRows: Array.from({ length: 12 }, (_, index) => ({ ...note,
      path: liteasyPath("local", { kind: "object", ref: { objectId: `note-${index}`, revision: "v1" } }),
      title: `Note ${index}`, summary: "文".repeat(1600)
    }))
  });
  const run = await fixture.submit("查找 notes 的相关资料");
  expect(run.status).toBe("completed");
  expect(fixture.requests).toHaveLength(1);
  expect(contextTokens(fixture.requests[0].prompt)).toBeLessThanOrEqual(4096 - 1024);
  expect(fixture.search).toHaveBeenCalledOnce();
  expect(fixture.read).not.toHaveBeenCalled();
  expect(run.events).toContainEqual(expect.objectContaining({ type: "assistant.message", message: expect.stringContaining("上下文预算") }));
  fixture.api.dispose();
});

test("a model cannot write an undiscovered guessed asset path", async () => {
  const unknownPath = liteasyPath("local", { kind: "object", ref: { objectId: "not-selected", revision: "v1" } });
  const fixture = setup([
    action({ action: "write", path: unknownPath, expectedRevision: "v1", text: "Guessed target" }),
    action({ message: "尚未修改；目标需要重新选择。" })
  ]);
  const run = await fixture.submit("更新这份笔记");
  expect(fixture.write).not.toHaveBeenCalled();
  expect(fixture.stat.mock.calls.some(([path]) => path === unknownPath)).toBe(false);
  expect(fixture.getText()).toBe("# Safety note");
  expect(run.events).toContainEqual(expect.objectContaining({ type: "manager.activity", status: "failed", detail: expect.stringContaining("不能猜测目标地址") }));
  expect(run.events.some((event) => event.type === "asset.written")).toBe(false);
  fixture.api.dispose();
});

test("a user write request does not make immutable paper assets writable", async () => {
  const fixture = setup([
    action({ action: "read", path: paperPath }),
    action({ action: "write", path: paperPath, expectedRevision: "v1", mode: "replace", text: "Changed original" }),
    action({ message: "论文原文只读，尚未修改。" })
  ]);
  const run = await fixture.submit("修改论文原文");
  expect(fixture.read).toHaveBeenCalledOnce();
  expect(fixture.write).not.toHaveBeenCalled();
  expect(run.events).toContainEqual(expect.objectContaining({ type: "manager.activity", status: "failed", detail: expect.stringContaining("只读") }));
  expect(run.events.some((event) => event.type === "asset.written")).toBe(false);
  fixture.api.dispose();
});
