import { createDesktopAgentService, type DesktopAgentEnvironment } from "../app/controllers/agent/createDesktopAgentService";
import { createOpenAIAgentsSdkManager } from "../app/controllers/agent/createOpenAIAgentsSdkManager";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { liteasyPath } from "../app/features/resource-filesystem/liteasyPath";
import type { AgentAsset } from "../app/features/resource-filesystem/agentAsset.types";
import { createAgentAssetService, readAgentAssetText } from "../app/features/resource-filesystem/agentAssetService";

const notePath = liteasyPath("local", { kind: "object", ref: { objectId: "cicn", revision: "v1" } });
const paperPath = liteasyPath("local", { kind: "paper", paperId: "cicada" });
const note: AgentAsset = { path: notePath, title: "CicN", kind: "content.note", revision: "v1", capabilities: ["read", "write", "search", "add_context"] };
const paper: AgentAsset = { path: paperPath, title: "Cicada", kind: "source.document", revision: "v1", capabilities: ["read", "search", "add_context"], summary: "Cicada is an in-memory transaction processing system." };
const action = (value: Record<string, unknown>) => JSON.stringify({ action: "answer", message: "", query: "", path: "", text: "", expectedRevision: "", mode: "append", offset: 0, ...value });

function setup(responses: string[]) {
  let text = "# CicN";
  let revision = "v1";
  const search = vi.fn(async () => [note, paper]);
  const read = vi.fn(async (path, options) => readAgentAssetText(path === notePath ? { ...note, revision } : paper,
    path === notePath ? text : "Cicada uses optimistic concurrency control and distributed timestamps.", options));
  const write = vi.fn(async (_path, options) => {
    text = options.mode === "replace" ? options.text : `${text}\n${options.text}`;
    const previousRevision = revision;
    revision = "v2";
    return { asset: { ...note, revision }, previousRevision, changed: true, addedLines: 2, removedLines: 0 };
  });
  const assets = createAgentAssetService({ scopeId: "local", active: () => true, adapters: [{
    id: "test", accepts: () => true, search, read, write,
    stat: async (path) => path === notePath ? { ...note, revision } : paper
  }] });
  const prompts: string[] = [];
  const resolveObjectContext = vi.fn(async () => { throw new Error("ordinary turns must not preload snapshots"); });
  const settings = createSettingsStore().getState();
  const environment: DesktopAgentEnvironment = {
    assets, assetScopeId: "local",
    knowledge: { selectedPapers: [{ id: "cicada", title: "Cicada" }], importedChunksByPaperId: {}, settings,
      modelTransport: async (request) => {
        prompts.push(JSON.parse(request.body).prompt);
        const answer = responses.shift();
        if (answer === undefined) throw new Error("unexpected model request");
        const payload = { answer, execution: { backend: "http_service", mode: "live", provider: "openai" } };
        return { ok: true, status: 200, json: async () => payload,
          body: new ReadableStream({ start(controller) {
            controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ ...payload, type: "completed" })}\n`)); controller.close();
          } }) };
      }
    }, runtime: {} as never
  };
  const sdk = createOpenAIAgentsSdkManager();
  const managerRun = vi.fn(sdk.run);
  const api = createDesktopAgentService({ getEnvironment: () => environment, resolveObjectContext,
    managerAgent: { ...sdk, run: managerRun } });
  const submit = async (message: string, attached = true) => {
    const session = await api.createSession({ consumer: "frontend" });
    if (!session.ok) throw new Error(session.error.message);
    const run = await api.submitTurn({ sessionId: session.data.sessionId, idempotencyKey: crypto.randomUUID(),
      input: { message, mode: "qa" }, ...(attached ? { contextRefs: [{ objectId: "cicn", revision: "v1" }] } : {}) });
    if (!run.ok) throw new Error(run.error.message);
    return run.data;
  };
  return { api, submit, read, search, write, prompts, managerRun, resolveObjectContext, environment, getText: () => text };
}

test("an attached note stays on the manager route and is actually written using paper evidence", async () => {
  const fixture = setup([
    action({ action: "search", query: "cicada" }),
    action({ action: "read", path: paperPath }),
    action({ action: "read", path: notePath }),
    action({ action: "write", path: notePath, expectedRevision: "v1", text: "## Cicada 要义\n乐观并发控制与分布式时间戳。" }),
    action({ message: "已将 Cicada 要义写入 CicN。" })
  ]);
  const run = await fixture.submit("往这个笔记里面，写入 cicada 的要义。");
  expect(run.status).toBe("completed");
  expect(fixture.managerRun).toHaveBeenCalledOnce();
  expect(fixture.resolveObjectContext).not.toHaveBeenCalled();
  expect(fixture.getText()).toContain("乐观并发控制");
  expect(fixture.prompts[0]).not.toContain("# CicN");
  expect(fixture.prompts[2]).toContain("optimistic concurrency control");
  expect(fixture.write).toHaveBeenCalledOnce();
  expect(run.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "context.usage", maxTokens: 32768, estimated: true }),
    expect.objectContaining({ type: "manager.activity", label: "已保存 · CicN", status: "completed" }),
    expect.objectContaining({ type: "assistant.message", metadata: expect.objectContaining({ assetWrites: [expect.objectContaining({ previousRevision: "v1" })] }) })
  ]));
  fixture.api.dispose();
});

test("hello makes one short model request without reading or searching the library", async () => {
  const fixture = setup(["你好！有什么可以帮你？"]);
  const run = await fixture.submit("hello", false);
  expect(run.status).toBe("completed");
  expect(fixture.prompts).toHaveLength(1);
  expect(fixture.prompts[0].length).toBeLessThan(200);
  expect(fixture.read).not.toHaveBeenCalled();
  expect(fixture.search).not.toHaveBeenCalled();
  expect(fixture.write).not.toHaveBeenCalled();
  fixture.api.dispose();
});

test("a read-only paper without a content revision can be read on demand", async () => {
  const fixture = setup([
    action({ action: "read", path: paperPath }),
    action({ message: "依据当前可用正文回答。" })
  ]);
  fixture.read.mockImplementationOnce(async (_path, options) => readAgentAssetText({ ...paper, revision: undefined }, "available paper text", options));
  const run = await fixture.submit("介绍一下这篇论文", false);
  expect(run.status).toBe("completed");
  expect(fixture.prompts.at(-1)).toContain("available paper text");
  expect(run.events).toContainEqual(expect.objectContaining({ type: "manager.activity", label: "读取 · Cicada", status: "completed" }));
  fixture.api.dispose();
});

test("a read-only user question cannot authorize a model-requested write", async () => {
  const fixture = setup([
    action({ action: "read", path: notePath }),
    action({ action: "write", path: notePath, expectedRevision: "v1", text: "unrequested change" }),
    action({ message: "该笔记只有标题。" })
  ]);
  const run = await fixture.submit("这个笔记包含什么？");
  expect(run.status).toBe("completed");
  expect(fixture.write).not.toHaveBeenCalled();
  expect(run.events).toContainEqual(expect.objectContaining({ type: "manager.activity", status: "failed", detail: expect.stringContaining("没有要求修改") }));
  fixture.api.dispose();
});

test("a stale write fails visibly and cannot produce a successful receipt", async () => {
  const fixture = setup([
    action({ action: "read", path: notePath }),
    action({ action: "write", path: notePath, expectedRevision: "old", text: "overwrite" }),
    action({ message: "版本已变更，尚未保存。" })
  ]);
  const run = await fixture.submit("更新这个笔记");
  expect(fixture.write).not.toHaveBeenCalled();
  expect(run.events).not.toContainEqual(expect.objectContaining({ label: "已保存 · CicN" }));
  expect(run.events).toContainEqual(expect.objectContaining({ type: "assistant.message", metadata: expect.objectContaining({ assetWrites: [] }) }));
  fixture.api.dispose();
});
