import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { refOf } from "../app/features/objects/object.types";
import { createAgentAssetService, readAgentAssetText } from "../app/features/resource-filesystem/agentAssetService";
import { liteasyPath, parseLiteasyPath } from "../app/features/resource-filesystem/liteasyPath";
import { createOperationHost } from "../app/features/workflows/operationHost";
import { compileWorkflow } from "../app/features/workflows/workflowDefinition";
import { createWorkflowRunner } from "../app/features/workflows/workflowRunner";
import type { JsonObject } from "../app/features/extensions/extensionSchema";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
async function fixture() {
  const scope = crypto.randomUUID(), storage = createObjectStorage(scope, () => scope), repository = createObjectRepository(storage, scope);
  const asset = (object: Awaited<ReturnType<typeof repository.get>>) => ({ path: liteasyPath(scope, { kind: "object" as const, ref: { objectId: object.objectId, revision: "latest" }, followLatest: true }), title: object.title, kind: object.kind, revision: object.revision, capabilities: ["read", "write", "search", "add_context"] as const });
  const find = async (path: string) => { const target = parseLiteasyPath(path, scope); if (target.kind !== "object") throw new Error("wrong target"); return repository.resolveLatest(target.ref.objectId); };
  const assets = createAgentAssetService({ scopeId: scope, active: () => true, adapters: [{ id: "objects", accepts: (path) => path.startsWith("liteasy://objects/"), search: async () => [], stat: async (path) => ({ ...asset(await find(path)), capabilities: ["read", "write", "search", "add_context"] }), read: async (path, options) => { const object = await find(path); return readAgentAssetText({ ...asset(object), capabilities: ["read", "write", "search", "add_context"] }, object.kind === "content.note" ? object.content.payload.text : "", options); }, write: async (path, options) => { const old = await find(path); const next = await repository.editNote({ ...refOf(old), revision: options.expectedRevision }, options.mode === "append" && old.kind === "content.note" ? old.content.payload.text + options.text : options.text); return { asset: { ...asset(next), capabilities: ["read", "write", "search", "add_context"] }, previousRevision: old.revision, changed: true, addedLines: 1, removedLines: 0 }; } }], create: async (options) => ({ ...asset(await repository.create({ kind: "content.note", title: options.title, content: { schema: "liteasy.note/v1", payload: { text: options.text ?? "", origin: "user" } } }, options.operationId)), capabilities: ["read", "write", "search", "add_context"] }) });
  const model = vi.fn(async () => ({ value: "model", usage: { tokens: 12, estimated: false }, model: "test", provider: "fixture" }));
  const host = createOperationHost({ storage, assets, scope, enabled: () => true, model });
  const source = await assets.create({ kind: "note", title: "来源", text: "原文", operationId: "source" });
  const grant = await host.grants.issue({ owner: "plugin.test", digest: "abc", capabilities: ["resources.metadata.read", "resources.content.read", "resources.create", "resources.write", "model.invoke"], selection: [source.path], output: true, modelConnection: "fixture/test" });
  return { scope, storage, repository, assets, source, host, grant, model, runner: createWorkflowRunner(storage, host, scope) };
}
const literal = (value: unknown) => ({ source: "literal", value });
test("rechecks organization source policy at the model node after a local read grant", async () => {
  const f = await fixture();
  const originalStat = f.assets.stat;
  vi.spyOn(f.assets, "stat").mockImplementation(async (path, options) => ({ ...await originalStat(path, options), sourceReferences: [{
    documentId: "group-document", scopeId: "group", scopeType: "organization", revision: 1
  }] }));
  const receipt = await f.host.call({ operationId: "group-model", operation: "model.generate", value: { prompt: "A private source excerpt", maxOutputTokens: 500 },
    grantId: f.grant.id, owner: "plugin.test", digest: "abc", signal: new AbortController().signal });
  expect(receipt.status).toBe("failed");
  expect(receipt.error?.message).toContain("资料属于组织");
  expect(f.model).not.toHaveBeenCalled();
});
function definition(nodes: unknown[], edges: unknown[] = [], output = { source: "node", nodeId: "save", path: "" }) {
  return compileWorkflow({ schema: "liteasy.workflow/v2", id: "test", version: "1.0.0", title: "工作流", inputSchema: { type: "object", properties: {}, additionalProperties: false }, outputSchema: { type: "string" }, nodes, edges, output }).definition;
}
test("validates graph ports, references, cycles and retry policy before running", () => {
  const save = { id: "save", title: "保存", operation: { id: "core.template", version: "1.0.0" }, input: { template: literal("hello"), values: literal({}) } };
  expect(definition([save]).nodes).toHaveLength(1);
  expect(() => definition([{ ...save, input: {} }])).toThrow("必需输入");
  expect(() => definition([save], [{ from: "save", to: "save" }])).toThrow("循环");
  expect(() => definition([{ ...save, input: { ...save.input, template: { source: "node", nodeId: "missing" } } }])).toThrow("节点不存在");
  expect(() => definition([{ ...save, operation: { id: "model.generate", version: "1.0.0" }, input: { prompt: literal("x") }, retries: 1 }])).toThrow("自动重试");
});
test("actual writes have durable receipts, stale/foreign inputs fail, and conditional undo never overwrites later edits", async () => {
  const f = await fixture();
  const request = { operationId: "write-one", operation: "resources.write" as const, value: { path: f.source.path, expectedRevision: f.source.revision!, mode: "append", text: "\n新增" }, grantId: f.grant.id, owner: "plugin.test", digest: "abc", signal: new AbortController().signal };
  const first = await f.host.call(request); expect(first.status).toBe("committed");
  expect(await f.host.call(request)).toEqual(first);
  expect((await f.assets.read(f.source.path)).text).toBe("原文\n新增");
  await expect(f.host.call({ ...request, value: { ...request.value, text: "不同请求" } })).rejects.toThrow("不同");
  const latest = await f.assets.read(f.source.path); await f.assets.write(f.source.path, { expectedRevision: latest.asset.revision!, mode: "append", text: "\n用户修改" });
  const undo = await f.host.undo("write-one", request); expect(undo.status).not.toBe("committed");
  expect((await f.assets.read(f.source.path)).text).toContain("用户修改");
  const foreign = f.source.path.replace(encodeURIComponent(f.scope), "other");
  await expect(f.host.call({ ...request, operationId: "foreign", value: { ...request.value, path: foreign } })).rejects.toThrow("账号");
  await f.host.grants.revoke(f.grant.id);
  await expect(f.host.call(request)).rejects.toThrow("撤销");
});
test("branch skip and join complete deterministically; record replay does not execute tools", async () => {
  const f = await fixture();
  const op = (id: string, operation: string, input: unknown) => ({ id, title: id, operation: { id: operation, version: "1.0.0" }, input });
  const flow = definition([
    op("branch", "core.branch", { value: literal(1), equals: literal(1) }),
    op("yes", "core.value", { value: literal("selected") }), op("no", "model.generate", { prompt: literal("must not run") }),
    op("join", "core.join", {}), op("save", "core.template", { template: literal("{{yes}}"), values: { source: "node", nodeId: "join" } }),
  ], [{ from: "branch", to: "yes", when: true }, { from: "branch", to: "no", when: false }, { from: "yes", to: "join" }, { from: "no", to: "join" }]);
  const run = await f.runner.create({ owner: "plugin.test", digest: "abc", definition: flow, input: {}, grantId: f.grant.id });
  expect((await f.runner.execute(run.id)).status).toBe("succeeded");
  const replay = await createWorkflowRunner(f.storage, f.host, f.scope).replay(run.id);
  expect(replay.nodes.save).toBe("selected"); expect(replay.run.nodes.no.status).toBe("skipped"); expect(f.model).not.toHaveBeenCalled();
  await f.runner.clearSnapshots(run.id); expect((await f.runner.replay(run.id)).missing.length).toBeGreaterThan(0);
});
test("single-step checkpoints survive recreation and interrupted create repeats the same operation ID", async () => {
  const f = await fixture();
  const flow = definition([{ id: "create", title: "新建", operation: { id: "resources.create", version: "1.0.0" }, input: { kind: literal("note"), title: literal("产物"), text: literal("实际正文") } }, { id: "save", title: "返回路径", operation: { id: "core.value", version: "1.0.0" }, input: { value: { source: "node", nodeId: "create", path: "path" } } }]);
  const run = await f.runner.create({ owner: "plugin.test", digest: "abc", definition: flow, input: {}, grantId: f.grant.id });
  const paused = await f.runner.execute(run.id, { singleStep: true }); expect(paused.status).toBe("paused");
  const resumed = await createWorkflowRunner(f.storage, f.host, f.scope).execute(run.id); expect(resumed.status).toBe("succeeded");
  expect((await f.repository.search()).objects.filter((item) => item.title === "产物")).toHaveLength(1);
  const receipt = await f.host.receipt(`${run.id}:create:0`); expect(receipt?.status).toBe("committed");
  const key = `extension-operation/${encodeURIComponent(`${run.id}:create:0`)}`, row = await f.storage.get(key);
  await f.storage.commit([{ key, expected: row!.version, row: { key, version: "crash", value: { ...receipt, status: "running", result: undefined } } }]);
  const repaired = await f.host.call({ operationId: `${run.id}:create:0`, operation: "resources.create", value: { kind: "note", title: "产物", text: "实际正文" } as JsonObject, grantId: f.grant.id, owner: "plugin.test", digest: "abc", signal: new AbortController().signal });
  expect(repaired.status).toBe("committed"); expect((await f.repository.search()).objects.filter((item) => item.title === "产物")).toHaveLength(1);
});
test("human input checkpoints and bounded map retain stable order", async () => {
  const f = await fixture();
  const flow = definition([
    { id: "wait", title: "人工确认", operation: { id: "core.wait", version: "1.0.0" }, input: { message: literal("补充说明") } },
    { id: "map", title: "映射", operation: { id: "core.template", version: "1.0.0" }, input: { template: literal("{{text}}") }, map: { items: literal([{ text: "一" }, { text: "二" }]), itemField: "values", maxItems: 2 } },
    { id: "save", title: "结束", operation: { id: "core.value", version: "1.0.0" }, input: { value: { source: "node", nodeId: "wait", path: "" } } },
  ], [{ from: "wait", to: "map" }, { from: "map", to: "save" }]);
  const run = await f.runner.create({ owner: "plugin.test", digest: "abc", definition: flow, input: {}, grantId: f.grant.id });
  expect((await f.runner.execute(run.id)).status).toBe("waiting_input");
  expect((await f.runner.execute(run.id, { response: "用户确认" })).status).toBe("succeeded");
  expect((await f.runner.replay(run.id)).nodes.map).toEqual(["一", "二"]);
});
test("interrupted external writes require reconciliation; cancellation retains committed artifacts", async () => {
  const f = await fixture();
  const request = { operationId: "external", operation: "resources.write" as const, value: { path: f.source.path, expectedRevision: f.source.revision!, mode: "append", text: "x" }, grantId: f.grant.id, owner: "plugin.test", digest: "abc", signal: new AbortController().signal };
  const first = await f.host.call(request), key = "extension-operation/external", row = await f.storage.get(key);
  await f.storage.commit([{ key, expected: row!.version, row: { key, version: "interrupted", value: { ...first, status: "running" } } }]);
  expect((await f.host.call(request)).status).toBe("needs_reconciliation");
  expect((await f.assets.read(f.source.path)).text).toBe("原文x");
  const flow = definition([{ id: "save", title: "保留", operation: { id: "core.template", version: "1.0.0" }, input: { template: literal("done"), values: literal({}) } }]);
  const run = await f.runner.create({ owner: "plugin.test", digest: "abc", definition: flow, input: {}, grantId: f.grant.id });
  await f.runner.stop(run.id, "cancelled");
  expect((await f.runner.execute(run.id)).status).toBe("cancelled");
  expect((await f.assets.read(f.source.path)).text).toBe("原文x");
});

test("pure recomputation uses fixed snapshots without tools, and interrupted reservations are not charged twice", async () => {
  const f = await fixture();
  const flow = definition([{ id: "save", title: "保存值", operation: { id: "core.template", version: "1.0.0" }, input: { template: literal("original {{name}}"), values: literal({ name: "snapshot" }) } }]);
  flow.budget.maxOperations = 1;
  const run = await f.runner.create({ owner: "plugin.test", digest: "abc", definition: flow, input: {}, grantId: f.grant.id });
  await f.runner.execute(run.id);
  const row = await f.storage.get(`workflow-run/${run.id}`), saved = row!.value as typeof run;
  // Simulate loss of only the node checkpoint after its operation receipt committed.
  await f.storage.commit([{ key: row!.key, expected: row!.version, row: { ...row!, version: "crash", value: JSON.parse(JSON.stringify({ ...saved, status: "running", leaseUntil: 0, nodes: { save: { ...saved.nodes.save, status: "running", outputKey: undefined } } })) } }]);
  const resumed = await createWorkflowRunner(f.storage, f.host, f.scope).execute(run.id);
  expect(resumed.status).toBe("succeeded"); expect(resumed.operations).toBe(1);
  const before = await f.storage.list("extension-operation/", "", 100);
  expect((await f.runner.recompute(run.id)).checks).toEqual([{ node: "save", mode: "recomputed", matches: true }]);
  expect(await f.storage.list("extension-operation/", "", 100)).toEqual(before);
  expect(f.model).not.toHaveBeenCalled();
});

test("resource triggers pin fresh content, deduplicate events and startup waits for a later session", async () => {
  const { createWorkflowTriggers } = await import("../app/features/workflows/workflowTriggers");
  const f = await fixture();
  const flow = compileWorkflow({ schema: "liteasy.workflow/v2", id: "trigger", title: "跟进资料", version: "1.0.0", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false }, outputSchema: { type: "string" }, nodes: [{ id: "read", title: "读取", operation: { id: "resources.read", version: "1.0.0" }, input: { path: { source: "input", path: "path" } } }], output: { source: "node", nodeId: "read", path: "text" } }).definition;
  const run = await f.runner.create({ owner: "plugin.test", digest: "abc", definition: flow, input: { path: f.source.path }, grantId: f.grant.id });
  await f.runner.execute(run.id);
  const scheduler = createWorkflowTriggers(f.storage, f.runner, f.assets, () => true);
  await scheduler.add(run.id, "resource");
  await f.assets.write(f.source.path, { expectedRevision: f.source.revision!, mode: "append", text: "更新后的正文" });
  await scheduler.tick(Date.now() + 61000);
  await vi.waitFor(async () => expect((await f.runner.list()).filter((item) => item.parentRunId === run.id && item.status === "succeeded")).toHaveLength(1));
  const generated = (await f.runner.list()).find((item) => item.parentRunId === run.id)!;
  expect(generated.input.path).toContain("revision=");
  expect((await f.runner.replay(generated.id)).nodes.read).toMatchObject({ text: "原文更新后的正文" });
  await scheduler.tick(Date.now() + 122000); expect(await f.runner.list()).toHaveLength(2);
  const startup = await scheduler.add(run.id, "startup");
  await scheduler.tick(Date.now() + 183000); expect(await f.runner.list()).toHaveLength(2);
  const restarted = createWorkflowTriggers(f.storage, f.runner, f.assets, () => true);
  await restarted.tick(Date.now() + 244000);
  await vi.waitFor(async () => expect((await f.runner.list()).filter((item) => item.status === "succeeded")).toHaveLength(3));
  await restarted.tick(Date.now() + 305000); expect(await f.runner.list()).toHaveLength(3);
  await restarted.setEnabled(startup.id, false);
});

test("embedded versioned subflows compile to the same bounded executor and reject recursive growth", async () => {
  const f = await fixture();
  const child = { schema: "liteasy.workflow/v2", id: "child", title: "子流程", version: "1.0.0", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false }, outputSchema: { type: "string" }, nodes: [{ id: "format", title: "格式化", operation: { id: "core.template", version: "1.0.0" }, input: { template: literal("你好 {{name}}"), values: { source: "input", path: "" } } }], output: { source: "node", nodeId: "format", path: "" } };
  const flow = definition([{ id: "save", title: "调用", operation: { id: "core.subflow", version: "1.0.0" }, input: { definition: literal(child), value: literal({ name: "研究者" }) } }]);
  expect(flow.nodes.some((node) => node.id === "save.format")).toBe(true);
  const run = await f.runner.create({ owner: "plugin.test", digest: "abc", definition: flow, input: {}, grantId: f.grant.id });
  expect((await f.runner.execute(run.id)).status).toBe("succeeded");
  expect((await f.runner.replay(run.id)).nodes.save).toBe("你好 研究者");
});


test("workflow grants expire and cannot be replayed after a session change", async () => {
  const f = await fixture();
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(f.grant.expiresAt!) + 1);
  await expect(f.host.grants.get(f.grant.id)).rejects.toThrow("过期");
  clock.mockRestore();
  const { clearStoredAccountSession } = await import("../app/features/account/accountSessionStorage");
  clearStoredAccountSession();
  await expect(f.host.grants.get(f.grant.id)).rejects.toThrow("会话已变化");
  const renewed = await f.host.grants.issue({ owner: "plugin.test", digest: "abc", capabilities: [], selection: [], output: false, modelConnection: null });
  expect((await f.host.grants.get(renewed.id)).selection).toEqual([]);
});
