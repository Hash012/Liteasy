import { compileExtensionWorkflow } from "../extensions/extensionPackage";
import { createTrialStorage, clearTrialStorage } from "./trialStorage";
import type { ObjectStorage } from "../objects/objectStorage";
import { createBlockRegistry } from "../visual-blocks/blockRegistry";
import { z } from "zod";
import { createObjectStorage } from "../objects/objectStorage";
import { createObjectRepository } from "../objects/objectRepository";
import { refOf, objectText } from "../objects/object.types";
import { createAgentAssetService, readAgentAssetText } from "../resource-filesystem/agentAssetService";
import { liteasyPath, parseLiteasyPath } from "../resource-filesystem/liteasyPath";
import { createOperationHost } from "../workflows/operationHost";
import { createWorkflowRunner } from "../workflows/workflowRunner";
import { compileWorkflow } from "../workflows/workflowDefinition";
import { buildExtensionPackage, validateExtensionPackage } from "../extensions/extensionPackage";
import type { JsonObject, JsonValue } from "../extensions/extensionSchema";
import type { ExtensionDraft, TrialReport } from "./extensionDraftStore";
const fixtureSchema = z.strictObject({ schema: z.literal("liteasy.workflow-fixture/v1"), name: z.string().max(120), workflow: z.string(), input: z.record(z.string(), z.json()), resources: z.array(z.strictObject({ id: z.string(), title: z.string(), text: z.string().max(80000) })).max(20), modelResponses: z.array(z.json()).max(20).default([]), expectedStatus: z.enum(["succeeded", "failed", "partial", "waiting_input"]).default("succeeded"), assertions: z.array(z.strictObject({ node: z.string(), path: z.string().default(""), equals: z.json().optional(), contains: z.string().optional() }).refine((item) => item.equals !== undefined || item.contains !== undefined)).min(1).max(40) });
function substitute(value: JsonValue, paths: Map<string, string>): JsonValue {
  if (typeof value === "string") return value.replace(/fixture:\/\/([a-zA-Z0-9.-]+)/g, (_, id: string) => { const path = paths.get(id); if (!path) throw new Error(`样例资源不存在 ${id}`); return path; });
  if (Array.isArray(value)) return value.map((item) => substitute(item, paths));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, paths)]));
  return value;
}
export async function trialExtension(draft: ExtensionDraft, active: () => boolean, parentScope?: string): Promise<TrialReport> {
  const pkg = await validateExtensionPackage(await buildExtensionPackage(draft.files));
  const cases: TrialReport["cases"] = [];
  const fixturePaths = Object.keys(draft.files).filter((path) => /^fixtures\/.+\.json$/.test(path));
  for (const path of fixturePaths) {
    let workflow = "unknown", name = path;
    let trialStorage: ObjectStorage | undefined;
    try {
      const fixture = fixtureSchema.parse(JSON.parse(draft.files[path])); workflow = fixture.workflow; name = fixture.name;
      const entry = pkg.manifest.contributes.workflows.find((item) => item.id === workflow);
      if (!entry) throw new Error("样例引用未声明的工作流。");
      const plan = compileExtensionWorkflow(pkg, entry.path);
      const trialId = crypto.randomUUID(), scope = `dev:${draft.id}:${trialId}`, accountScope = parentScope ?? scope;
      const storage = createTrialStorage(createObjectStorage(accountScope, () => active() ? accountScope : "closed"), trialId), repository = createObjectRepository(storage, scope);
      trialStorage = storage;
      const paths = new Map<string, string>();
      const asset = (object: Awaited<ReturnType<typeof repository.get>>) => ({ path: liteasyPath(scope, { kind: "object" as const, ref: { objectId: object.objectId, revision: "latest" }, followLatest: true }), title: object.title, kind: object.kind, revision: object.revision, capabilities: ["read", "write", "search", "add_context"] as Array<"read" | "write" | "search" | "add_context"> });
      const find = async (path: string) => { const target = parseLiteasyPath(path, scope); if (target.kind !== "object") throw new Error("试跑只能操作样例副本。"); return repository.resolveLatest(target.ref.objectId); };
      const assets = createAgentAssetService({ scopeId: scope, active, adapters: [{ id: "fixtures", accepts: (path) => path.startsWith("liteasy://objects/"), search: async () => (await repository.search()).objects.map(asset), stat: async (path) => asset(await find(path)), read: async (path, options) => { const object = await find(path); return readAgentAssetText(asset(object), objectText(object), options); }, write: async (path, input) => { const before = await find(path); const object = await repository.editNote({ ...refOf(before), revision: input.expectedRevision }, input.mode === "append" ? objectText(before) + input.text : input.text, undefined, [], "agent"); return { asset: asset(object), previousRevision: before.revision, changed: before.revision !== object.revision, addedLines: 1, removedLines: 0 }; } }],
        create: async (options) => asset(await repository.create(options.kind === "note" ? { kind: "content.note", title: options.title, content: { schema: "liteasy.note/v1", payload: { text: options.text ?? "", origin: "user" } } } : { kind: "workspace.board", title: options.title, content: { schema: "liteasy.board/v1", payload: { description: "" } } }, options.operationId)),
      });
      for (const resource of fixture.resources) { if (paths.has(resource.id)) throw new Error("样例资源 ID 重复。"); const item = await assets.create({ kind: "note", title: resource.title, text: resource.text, operationId: `fixture:${resource.id}` }); paths.set(resource.id, item.path); }
      let modelCalls = 0;
      const host = createOperationHost({ storage, assets, scope, repository, registry: () => createBlockRegistry(pkg.blocks), enabled: () => active(), model: async () => { if (modelCalls >= fixture.modelResponses.length) throw new Error("缺少本次模型 mock 响应。"); return { value: substitute(fixture.modelResponses[modelCalls++], paths), usage: { tokens: 0, estimated: false }, model: "fixture", provider: "mock" }; }, open: async () => undefined });
      const grant = await host.grants.issue({ owner: pkg.manifest.id, digest: pkg.digest, capabilities: plan.capabilities, selection: [...paths.values()], output: true, modelConnection: "mock/fixture" });
      const runner = createWorkflowRunner(storage, host, scope);
      const run = await runner.create({ owner: pkg.manifest.id, digest: pkg.digest, definition: plan.definition, input: substitute(fixture.input, paths) as JsonObject, grantId: grant.id });
      const result = await runner.execute(run.id), replay = await runner.replay(run.id);
      if (result.status !== fixture.expectedStatus) throw new Error(`预期 ${fixture.expectedStatus}，实际 ${result.status}: ${result.error ?? ""}`);
      for (const assertion of fixture.assertions) {
        let value: JsonValue | undefined = replay.nodes[assertion.node];
        for (const part of assertion.path ? assertion.path.split(".") : []) value = value && typeof value === "object" ? Array.isArray(value) ? value[Number(part)] : value[part] : undefined;
        if (assertion.equals !== undefined && JSON.stringify(value) !== JSON.stringify(substitute(assertion.equals, paths))) throw new Error(`${assertion.node}.${assertion.path}: 值不符合验收条件。`);
        if (assertion.contains !== undefined && (typeof value !== "string" || !value.includes(String(substitute(assertion.contains, paths))))) throw new Error(`${assertion.node}.${assertion.path}: 缺少要求的内容。`);
      }
      cases.push({ name, workflow, passed: true, runId: run.id });
    } catch (e) { cases.push({ name, workflow, passed: false, error: e instanceof Error ? e.message : String(e) }); }
    finally { if (trialStorage) await clearTrialStorage(trialStorage).catch(() => undefined); }
  }
  for (const workflow of pkg.manifest.contributes.workflows) if (!cases.some((item) => item.workflow === workflow.id)) cases.push({ name: "缺少可执行样例", workflow: workflow.id, passed: false, error: "发布前至少提供一个 fixtures/*.json 真实执行样例。" });
  // Pure UI packages are validated and rendered by the preview; no fabricated process success.
  return { schema: "liteasy.extension-trial/v1", digest: pkg.digest, at: new Date().toISOString(), cases, passed: cases.every((item) => item.passed) };
}
