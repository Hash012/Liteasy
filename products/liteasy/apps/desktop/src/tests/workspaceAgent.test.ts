import type { AgentRun } from "../app/features/agent-api/agentApi.types";
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
  const approve = async (run: AgentRun) => {
    expect(run.status).toBe("waiting_confirmation");
    expect(write).not.toHaveBeenCalled();
    const confirmation = run.events.find((event) => event.type === "confirmation.required");
    if (!confirmation || confirmation.type !== "confirmation.required") throw new Error("Missing confirmation");
    const result = await api.resolveConfirmation({ sessionId: run.sessionId, confirmationId: confirmation.confirmationId, decision: "approve" });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  };
  return { api, submit, approve, read, search, write, prompts, managerRun, resolveObjectContext, environment, getText: () => text };
}

test("an attached note stays on the manager route and is actually written using paper evidence", async () => {
  const fixture = setup([
    action({ action: "search", query: "cicada" }),
    action({ action: "read", path: paperPath }),
    action({ action: "read", path: notePath }),
    action({ action: "write", path: notePath, expectedRevision: "v1", text: "## Cicada 要义\n乐观并发控制与分布式时间戳。" }),
    action({ message: "已将 Cicada 要义写入 CicN。" })
  ]);
  const run = await fixture.approve(await fixture.submit("往这个笔记里面，写入 cicada 的要义。"));
  expect(run.status).toBe("completed");
  expect(fixture.managerRun).toHaveBeenCalledOnce();
  expect(fixture.resolveObjectContext).not.toHaveBeenCalled();
  expect(fixture.getText()).toContain("乐观并发控制");
  expect(fixture.prompts[0]).not.toContain("# CicN");
  expect(fixture.prompts[2]).toContain("optimistic concurrency control");
  expect(fixture.write).toHaveBeenCalledOnce();
  expect(run.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "context.usage", maxTokens: 32768, estimated: true }),
    expect.objectContaining({ type: "asset.written", receipt: expect.objectContaining({ previousRevision: "v1" }) }),
    expect.objectContaining({ type: "assistant.message", message: expect.stringContaining("已保存") })
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
  expect(run.status).toBe("waiting_confirmation");
  expect(fixture.write).not.toHaveBeenCalled();
  expect(run.events).toContainEqual(expect.objectContaining({ type: "confirmation.required", summary: expect.stringContaining("确认前不会修改") }));
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

test("reads and writes an attached note through equivalent URLs while exposing real action details", async () => {
  const fixture = setup([
    action({ action: "read", path: "liteasy://objects/cicn?revision=v1", message: "先读取笔记，保留已有内容。" }),
    action({ action: "write", path: "liteasy://objects/cicn", expectedRevision: "v1", text: "\nhello", message: "将 hello 追加到笔记末尾。" }),
    action({ message: `已更新 [《CicN》](${notePath})。` })
  ]);
  const run = await fixture.approve(await fixture.submit("往这里写入 hello"));
  expect(fixture.read).toHaveBeenCalledWith(notePath, expect.anything());
  expect(fixture.write).toHaveBeenCalledWith(notePath, expect.objectContaining({ expectedRevision: "v1" }));
  expect(fixture.search).not.toHaveBeenCalled();
  expect(run.events).not.toContainEqual(expect.objectContaining({ type: "manager.activity", status: "failed" }));
  const read = run.events.find((event) => event.type === "manager.activity" && event.label === "读取 · CicN" && event.status === "completed");
  expect(read).toMatchObject({ detail: expect.stringContaining("先读取笔记，保留已有内容。") });
  expect(read).toMatchObject({ detail: expect.stringContaining(`[《CicN》](${notePath})`) });
  expect(read).toMatchObject({ detail: expect.stringContaining("内容预览") });
  expect(fixture.getText()).toContain("hello");
  fixture.api.dispose();
});

test("applies local profile preferences to actual workspace model requests, and only response preferences to greetings", async () => {
  const fixture = setup([action({ message: "先给结论。" }), "Hello!"]);
  fixture.environment.personalization = { summary: "研究主题：分布式数据库；回答方式：先给结论", response: "回答语言：English" };
  await fixture.submit("介绍事务隔离", false);
  expect(fixture.prompts[0]).toContain("分布式数据库");
  expect(fixture.prompts[0]).toContain("先给结论");
  await fixture.submit("hello", false);
  expect(fixture.prompts[1]).toContain("English");
  expect(fixture.prompts[1]).not.toContain("分布式数据库");
  expect(fixture.read).not.toHaveBeenCalled();
  fixture.api.dispose();
});

test("retains early requests beyond eight and twelve turns in the same session", async () => {
  const fixture = setup(Array.from({ length: 15 }, (_, i) => action({ message: `答复 ${i}` })));
  const session = await fixture.api.createSession({ consumer: "frontend" });
  if (!session.ok) throw new Error(session.error.message);
  try {
    for (let i = 0; i < 15; i++) {
      const run = await fixture.api.submitTurn({ sessionId: session.data.sessionId, idempotencyKey: crypto.randomUUID(), input: { mode: "qa", message: i === 0 ? "研究约束：EXPERIMENT-73，禁止丢失" : `继续讨论第 ${i} 轮` } });
      expect(run.ok).toBe(true);
      if (run.ok) expect(run.data.status).toBe("completed");
    }
    expect(fixture.prompts.at(-1)).toContain("EXPERIMENT-73");
    expect(fixture.prompts.at(-1)).toContain("答复 0");
  } finally { fixture.api.dispose(); }
});

test("recovers exact older content through session history when the working window is compacted", async () => {
  const longAnswer = "older text ".repeat(1500) + "DECISION-73" + " more text".repeat(1500);
  const fixture = setup([action({ message: longAnswer }), action({ message: longAnswer }),
    action({ action: "history", query: "DECISION-73", offset: 16000 }), action({ message: "已核对早期原文中的 DECISION-73。" })]);
  fixture.environment.knowledge.settings["assistant.context_window"] = "8192";
  const session = await fixture.api.createSession({ consumer: "frontend" });
  if (!session.ok) throw new Error(session.error.message);
  try {
    for (const message of ["讨论第一次实验", "讨论第二次实验", "核对最初的实验编号"]) {
      const run = await fixture.api.submitTurn({ sessionId: session.data.sessionId, idempotencyKey: crypto.randomUUID(), input: { mode: "qa", message } });
      expect(run.ok).toBe(true);
      if (run.ok) {
        expect(run.data.status).toBe("completed");
        if (message === "核对最初的实验编号") {
          expect(run.data.events).toContainEqual(expect.objectContaining({ type: "context.usage", history: expect.objectContaining({ totalTurns: 2, compactedTurns: 2 }) }));
          expect(run.data.events).toContainEqual(expect.objectContaining({ type: "manager.activity", label: "回顾历史对话", status: "completed" }));
        }
      }
    }
    expect(fixture.prompts.at(-1)).toContain("DECISION-73");
    expect(fixture.read).not.toHaveBeenCalled();
  } finally { fixture.api.dispose(); }
});

test("negated write words do not authorize a valid model write", async () => {
  const fixture = setup([
    action({ action: "read", path: notePath }),
    action({ action: "write", path: notePath, expectedRevision: "v1", text: "unauthorized" }),
    action({ message: "只讨论写入。" })
  ]);
  await fixture.submit("不要修改笔记，只讨论写入");
  expect(fixture.write).not.toHaveBeenCalled();
  expect(fixture.getText()).toBe("# CicN");
  fixture.api.dispose();
});

const researchAction = (status: "open" | "addressed" | "blocked", evidencePaths: string[] = []) => action({ action: "research", text: JSON.stringify({
  plan: ["读取并对照当前文库来源", "检索局限与相反证据", "保留有来源的结论"],
  gaps: [{ id: "counterevidence", kind: "missing_source", question: "Cicada 有哪些局限或反例？", status, evidencePaths, resolution: status === "addressed" ? "已读取本地相关材料，未独立核验，答案保留适用条件。" : "" }]
}) });

test("research gaps drive actual search/read and prevent a premature completed answer", async () => {
  const fixture = setup([
    researchAction("open"),
    action({ message: "没有任何问题，研究完成。" }),
    action({ action: "search", query: "Cicada limitations counterexample" }),
    action({ action: "read", path: paperPath }),
    researchAction("addressed", [paperPath]),
    action({ message: "依据读到的材料整理结论，仍需独立核验。" })
  ]);
  try {
    const run = await fixture.submit("研究 Cicada 的局限和反证", false);
    expect(fixture.search).toHaveBeenCalledWith(expect.objectContaining({ query: "Cicada limitations counterexample" }));
    expect(fixture.read).toHaveBeenCalledOnce();
    expect(fixture.prompts[2]).toContain("unresolved_gaps");
    const result = run.events.filter((event) => event.type === "assistant.message").at(-1);
    expect(result).toMatchObject({ message: "依据读到的材料整理结论，仍需独立核验。", metadata: { researchLoop: {
      status: "completed", stopReason: "task_completed", semanticStatus: "unverified", checkpoint: { mutations: "confirmation_required", readAssets: [expect.objectContaining({ path: paperPath })] }
    } } });
    expect(fixture.write).not.toHaveBeenCalled();
  } finally { fixture.api.dispose(); }
});

test("blocked research stops with unresolved questions instead of claiming task completion", async () => {
  const fixture = setup([researchAction("blocked")]);
  try {
    const run = await fixture.submit("研究 Cicada 的局限", false);
    expect(fixture.prompts).toHaveLength(1);
    expect(run.events).toContainEqual(expect.objectContaining({ type: "assistant.message", message: expect.stringContaining("仍有问题需要复核"), metadata: expect.objectContaining({ researchLoop: expect.objectContaining({ stopReason: "needs_review", status: "needs_review" }) }) }));
  } finally { fixture.api.dispose(); }
});

test("a model interruption retains a read checkpoint and never replays a mutation", async () => {
  const fixture = setup([researchAction("open"), action({ action: "read", path: paperPath })]);
  try {
    const run = await fixture.submit("研究 Cicada 的局限", false);
    expect(run.events).toContainEqual(expect.objectContaining({ type: "assistant.message", metadata: expect.objectContaining({ researchLoop: expect.objectContaining({ stopReason: "interrupted", checkpoint: expect.objectContaining({ readAssets: [expect.objectContaining({ path: paperPath, revision: "v1" })] }) }) }) }));
    expect(fixture.write).not.toHaveBeenCalled();
  } finally { fixture.api.dispose(); }
});


test("partial research keeps read-backed findings and clickable sources alongside unresolved gaps", async () => {
  const fixture = setup([
    action({ action: "read", path: paperPath }),
    action({ action: "research", text: JSON.stringify({ plan: ["读取机制与反例"], gaps: [
      { id: "mechanism", kind: "missing_source", question: "机制是什么？", status: "addressed", evidencePaths: [paperPath], resolution: "Cicada 使用乐观并发控制与分布式时间戳。" },
      { id: "counterexample", kind: "missing_source", question: "没有找到反例，请补充实验资料。", status: "blocked", evidencePaths: [], resolution: "" }
    ] }) })
  ]);
  try {
    const run = await fixture.submit("研究 Cicada 的机制与反例", false);
    const result = run.events.filter((event) => event.type === "assistant.message").at(-1);
    if (!result || result.type !== "assistant.message") throw new Error("missing research response");
    expect(result.message).toContain("没有找到反例，请补充实验资料。");
    expect(result.message).toContain("已整理的线索（未独立核验）");
    expect(result.message).toContain("Cicada 使用乐观并发控制与分布式时间戳。");
    expect(result.message).toContain(`[《Cicada》](${paperPath})`);
    const { evidenceAnswerRevision } = await import("../app/features/evidence/evidenceReport");
    expect(result.metadata).toMatchObject({ researchLoop: { stopReason: "needs_review", semanticStatus: "unverified" }, evidenceReport: { answerRevision: evidenceAnswerRevision(result.message) } });
    expect(fixture.prompts).toHaveLength(2);
    expect(fixture.write).not.toHaveBeenCalled();
  } finally { fixture.api.dispose(); }
});
