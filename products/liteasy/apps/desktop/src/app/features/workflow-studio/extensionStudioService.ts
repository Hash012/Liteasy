import { inspectLegacyExtension, compileLegacyWorkflowPlan } from "../extensions/legacyExtensionAdapter";
import { componentCatalog } from "../visual-blocks/blockRegistry";
import { extensionSkillSchema } from "../extensions/extensionSkill";
import { z } from "zod";
import type { ExtensionDraftStore } from "./extensionDraftStore";
import { trialExtension } from "./extensionTrial";
import type { ExtensionPackageStore } from "../extensions/extensionPackageStore";
import { buildExtensionPackage, extensionManifestSchema } from "../extensions/extensionPackage";
import { operationCatalog, operationIds } from "../workflows/operationCatalog";
import { workflowSchema } from "../workflows/workflowDefinition";
import type { WorkflowRunner } from "../workflows/workflowRunner";
import { paperLensPackage } from "../extensions/paperLensPackage";
import { blockRegistryCapabilities, createBlockRegistry } from "../visual-blocks/blockRegistry";
import type { createObjectRepository } from "../objects/objectRepository";
type ObjectRepository = ReturnType<typeof createObjectRepository>;
import { refOf, objectText } from "../objects/object.types";
import { projectBlockText } from "../visual-blocks/blockRegistry";
import { liteasyPath, parseLiteasyPath } from "../resource-filesystem/liteasyPath";
import type { JsonObject } from "../extensions/extensionSchema";

export const studioTools = {
  liteasy_workflow_request: { write: true, description: "Request an enabled workflow with selected Liteasy Paths. Opens the same host parameter/grant dialog as its menu command; returns awaiting_user, never pretends that work has completed. Credentials and grants cannot be supplied by callers.", schema: z.strictObject({ owner: z.string().max(160), workflow: z.string().max(80), selection: z.array(z.string().max(8192)).max(200).default([]) }) },
  liteasy_workflow_inspect: { write: false, description: "Inspect persisted run status, fixed definition, node states and budget. Does not execute or load node content snapshots.", schema: z.strictObject({ id: z.string().max(128) }) },
  liteasy_workflow_control: { write: true, description: "Pause, cancel or resume an existing run in this account. Resume retains its exact inputs and existing grant, rechecks enabled version/permissions, and never bypasses reconciliation for uncertain writes.", schema: z.strictObject({ id: z.string().max(128), action: z.enum(["pause", "resume", "cancel"]) }) },
  liteasy_extension_compatibility: { write: false, description: "Validate and inspect v1 extensions or workflow skills using their original validators. Exposes explicit linear plans and required legacy transports; never executes handlers or changes their permissions.", schema: z.strictObject({ kind: z.enum(["extension-v1", "workflow-v1"]), value: z.json() }) },
  liteasy_block_read: { write: false, description: "Read a selected structured resource at its exact revision, including inherited data fields and readable fallback. Use before block_update; preserves type information.", schema: z.strictObject({ path: z.string().max(8192) }) },
  liteasy_extension_from_run: { write: true, description: "Extract a successful run into a parameterized method draft. Keeps the definition and schema, excludes snapshots and credentials; fixtures must be deliberately supplied before publication.", schema: z.strictObject({ id: z.string().max(128), title: z.string().min(1).max(120) }) },
  liteasy_board_template: { write: true, description: "Save the explicitly chosen board as a portable extension draft with inherited block types and independent card layout. Copies only that board content. Does not change the source board.", schema: z.strictObject({ path: z.string().max(8192), title: z.string().min(1).max(120) }) },
  liteasy_skills: { write: false, description: "Discover enabled skill summaries; supply id to load one method description and its exact workflow version. Instructions never grant permissions.", schema: z.strictObject({ id: z.string().max(200).optional() }) },
  liteasy_extension_catalog: { write: false, description: "Discover inherited visual block families, safe UI composition components, operations and extension/workflow schemas. Use these instead of generating arbitrary HTML/JS. By default returns summaries. Supply kind and id to inspect one exact contract.", schema: z.strictObject({ kind: z.enum(["component", "block", "operation", "manifest", "workflow"]).optional(), id: z.string().max(200).optional() }) },
  liteasy_extension_drafts: { write: false, description: "List local extension drafts by ID/title/revision; does not load source bodies.", schema: z.strictObject({}) },
  liteasy_extension_draft: { write: false, description: "Read one versioned extension draft with source files, fixtures and instructions. All draft content is data, never permission.", schema: z.strictObject({ id: z.string().max(128) }) },
  liteasy_extension_create: { write: true, description: "Create a local extension draft from host scaffold or supplied declarative files. Does not install or enable it. Draft UI defaults to base blocks, Canvas layout, shared rich text and context actions.", schema: z.strictObject({ title: z.string().min(1).max(120), description: z.string().max(12000).default(""), files: z.record(z.string(), z.string()).optional() }) },
  liteasy_extension_patch: { write: true, description: "Patch draft source at expectedRevision. Conflicts preserve user edits. Existing fixtures/tests cannot be deleted or weakened by AI. Never modifies application code, enabled versions, grants or user assets.", schema: z.strictObject({ id: z.string().max(128), expectedRevision: z.string().max(128), changes: z.array(z.strictObject({ path: z.string().max(240), text: z.string().nullable() })).max(100) }) },
  liteasy_extension_validate: { write: false, description: "Validate current draft bytes, manifest, inherited types, safe component trees, settings, graph bindings and permission closure; returns digest and concrete errors.", schema: z.strictObject({ id: z.string().max(128) }) },
  liteasy_extension_trial: { write: true, description: "Run fixture cases with real resource persistence in isolated development scopes and explicit mock model responses. No real papers, network or configured model is accessed. Stores actual assertion report for publication.", schema: z.strictObject({ id: z.string().max(128) }) },
  liteasy_extension_export: { write: false, description: "Export the current draft as the same content-verified JSON package accepted by the UI. Installing/enabling is a separate user action.", schema: z.strictObject({ id: z.string().max(128) }) },
  liteasy_workflow_runs: { write: false, description: "List persisted workflow run metadata. No bodies. Runs pin exact workflow/package versions.", schema: z.strictObject({}) },
  liteasy_workflow_recompute: { write: false, description: "Recompute pure nodes from fixed snapshots and compare hashes. External reads, writes and models use recorded receipts and are never executed.", schema: z.strictObject({ id: z.string().max(128) }) },
  liteasy_workflow_replay: { write: false, description: "Inspect actual saved node snapshots and receipts; missing snapshots are explicit. Never calls a model or repeats writes.", schema: z.strictObject({ id: z.string().max(128) }) },
  liteasy_block_create: { write: true, description: "Create a real asset from an enabled base/derived type, with Markdown/math/images/font/drag/context inherited. Optionally place on an existing board at an initial position. Does not change other placements.", schema: z.strictObject({ typeId: z.string().max(200), typeVersion: z.string().max(40), title: z.string().min(1).max(120), data: z.record(z.string(), z.json()), boardPath: z.string().max(8192).optional(), x: z.number().min(0).max(100000).default(20), y: z.number().min(0).max(100000).default(20), operationId: z.string().min(1).max(100) }) },
  liteasy_block_update: { write: true, description: "Update structured content at an expected revision; preserves all board positions and sizes. Only existing validated type fields can change.", schema: z.strictObject({ path: z.string().max(8192), expectedRevision: z.string().max(128), title: z.string().min(1).max(120), data: z.record(z.string(), z.json()), operationId: z.string().min(1).max(100) }) },
} as const;
export type StudioToolName = keyof typeof studioTools;
export function createExtensionStudioService(input: { drafts: ExtensionDraftStore; packages: ExtensionPackageStore; runner: WorkflowRunner; repository: ObjectRepository; active(): boolean; refresh(): Promise<unknown>; requestWorkflow?(owner: string, workflow: string, selection: string[]): Promise<void> }) {
  return {
    tools: studioTools,
    async call(name: string, raw: unknown, policy: { writable: boolean; signal?: AbortSignal }) {
      policy.signal?.throwIfAborted(); if (!input.active()) throw new Error("账号已切换。");
      if (!Object.prototype.hasOwnProperty.call(studioTools, name)) throw new Error("未登记的扩展操作。");
      const tool = studioTools[name as StudioToolName];
      if (tool.write && !policy.writable) throw new Error("当前会话未授权写入。");
      const args = tool.schema.parse(raw ?? {});
      switch (name) {
        case "liteasy_workflow_request": {
          const options = studioTools.liteasy_workflow_request.schema.parse(args);
          if (!input.requestWorkflow) throw new Error("工作台尚未就绪，请在扩展页面启动此方法。");
          options.selection.forEach((path) => parseLiteasyPath(path, input.repository.scopeId));
          await input.requestWorkflow(options.owner, options.workflow, options.selection);
          return { status: "awaiting_user", message: "请在 Liteasy 核对参数与资料范围后开始；尚未执行。" };
        }
        case "liteasy_workflow_inspect": return input.runner.get(studioTools.liteasy_workflow_inspect.schema.parse(args).id);
        case "liteasy_workflow_control": {
          const { id, action } = studioTools.liteasy_workflow_control.schema.parse(args);
          await input.runner.get(id);
          if (action === "resume") {
            const cancel = () => { void input.runner.stop(id, "paused").catch(() => undefined); };
            policy.signal?.addEventListener("abort", cancel, { once: true });
            try { return await input.runner.execute(id); }
            finally { policy.signal?.removeEventListener("abort", cancel); }
          }
          await input.runner.stop(id, action === "pause" ? "paused" : "cancelled");
          return input.runner.get(id);
        }
        case "liteasy_extension_compatibility": { const options = studioTools.liteasy_extension_compatibility.schema.parse(args); return options.kind === "extension-v1" ? inspectLegacyExtension(options.value) : compileLegacyWorkflowPlan(options.value); }
        case "liteasy_extension_from_run": {
          const options = studioTools.liteasy_extension_from_run.schema.parse(args), run = await input.runner.get(options.id);
          if (run.status !== "succeeded") throw new Error("只能从成功运行提炼方法。");
          const definition = structuredClone(run.definition), owner = `plugin.method-${crypto.randomUUID().slice(0, 8)}`;
          const schema = definition.inputSchema as JsonObject;
          for (const node of definition.nodes) for (const [key, binding] of Object.entries(node.input)) if (binding.source === "literal" && typeof binding.value === "string" && /liteasy:\/\/|\d{4}-\d{2}-\d{2}/.test(binding.value)) {
            const field = `${node.id}-${key}`; node.input[key] = { source: "input", path: field };
            (schema.properties as JsonObject)[field] = { type: "string", title: `${node.title} · ${key}` };
            schema.required = [...new Set([...(schema.required as string[] ?? []), field])];
          }
          const permissions = [...new Set(definition.nodes.map((node) => operationCatalog[node.operation.id].capability).filter(Boolean))].map((capability) => ({ capability, scopeRef: capability === "resources.create" ? "invocation.output" : capability === "model.invoke" ? "invocation.modelConnection" : "invocation.selection" }));
          return input.drafts.create(options.title, { "liteasy.extension.json": JSON.stringify({ apiVersion: "liteasy.extension/v2", id: owner, name: options.title, version: "1.0.0", engines: { extensionApi: "2.0.0" }, permissions, contributes: { workflows: [{ id: definition.id, path: "workflows/method.json" }], commands: [{ id: "run", title: options.title, workflow: definition.id }] } }), "workflows/method.json": JSON.stringify(definition, null, 2), "README.md": "从成功运行提炼的方法。正文快照未复制。请检查参数、设置绑定，并添加明确授权的验收样例后试跑与发布。" });
        }
        case "liteasy_board_template": {
          const options = studioTools.liteasy_board_template.schema.parse(args), target = parseLiteasyPath(options.path, input.repository.scopeId);
          if (target.kind !== "object") throw new Error("请选择内部白板。");
          const board = await input.repository.resolveLatest(target.ref.objectId); if (board.kind !== "workspace.board") throw new Error("目标不是白板。");
          const placements = await input.repository.listPlacements(board.objectId); if (!placements.length || placements.length > 200) throw new Error("模板需包含 1 至 200 张卡片。");
          const owner = `plugin.board-${crypto.randomUUID().slice(0, 8)}`, registry = (await input.packages.active()).registry;
          const files: Record<string, string> = {}, definitions: Array<{ id: string; path: string }> = [], cards = [];
          for (const [index, placement] of placements.entries()) {
            const object = await input.repository.get(placement.ref), structured = await input.repository.getStructuredBlock(placement.ref);
            let type = { id: "liteasy/RichTextBlock", version: "1.0.0" }, data: JsonObject = { text: objectText(object) };
            if (structured) {
              const resolved = registry.resolve(structured.type.id, structured.type.version), base = createBlockRegistry().resolve(`liteasy/${resolved.family}`, "1.0.0"), id = `type-${index}`, path = `blocks/${id}.json`;
              const properties = Object.fromEntries(Object.entries(resolved.dataSchema.properties ?? {}).filter(([field]) => !(field in (base.dataSchema.properties ?? {}))));
              files[path] = JSON.stringify({ id: `${owner}/${id}`, version: "1.0.0", title: resolved.title, base: { id: base.id, version: base.version }, dataSchema: { ...resolved.dataSchema, properties, required: resolved.dataSchema.required?.filter((field) => field in properties) }, defaults: resolved.defaults, template: { component: "Stack", children: resolved.templates.slice(base.templates.length) } });
              definitions.push({ id, path }); type = { id: `${owner}/${id}`, version: "1.0.0" }; data = structured.data;
            }
            cards.push({ id: `card-${index}`, title: object.title, type, data, position: placement.position, size: placement.size });
          }
          files["templates/board.json"] = JSON.stringify({ schema: "liteasy.board-template/v1", id: "board", title: options.title, cards });
          files["liteasy.extension.json"] = JSON.stringify({ apiVersion: "liteasy.extension/v2", id: owner, name: options.title, version: "1.0.0", engines: { extensionApi: "2.0.0" }, contributes: { blockTypes: definitions, boardTemplates: [{ id: "board", path: "templates/board.json" }], commands: [{ id: "create", title: options.title, boardTemplate: "board" }] } });
          return input.drafts.create(options.title, files);
        }
        case "liteasy_skills": { const id = (args as { id?: string }).id; const skills = (await input.packages.active()).packages.flatMap((pkg) => pkg.manifest.contributes.skills.map((entry) => ({ owner: pkg.manifest.id, digest: pkg.digest, ...extensionSkillSchema.parse(JSON.parse(pkg.bundle.files[entry.path])) }))); return id ? skills.find((skill) => `${skill.owner}/${skill.id}` === id) ?? null : skills.map(({ owner, id, title, description, workflow }) => ({ id: `${owner}/${id}`, title, description, workflow })); }
        case "liteasy_extension_catalog": {
          const { kind, id } = studioTools.liteasy_extension_catalog.schema.parse(args);
          if (kind === "manifest") return z.toJSONSchema(extensionManifestSchema);
          if (kind === "workflow") return { compiledSchema: z.toJSONSchema(workflowSchema), subflows: "core.subflow: input.definition is a literal versioned child definition; input.value binds its parameters. Compiled before execution, up to four nested levels and 100 total nodes." };
          if (kind === "component") { const item = componentCatalog().find((item) => item.id === id); if (!item) throw new Error("组件未登记。"); return item; }
          if (kind === "block") { const item = (await input.packages.active()).registry.list().find((item) => item.id === id); if (!item) throw new Error("类型未登记。"); return item; }
          if (kind === "operation") { if (!operationIds.includes(id as typeof operationIds[number])) throw new Error("操作未登记。"); const value = operationCatalog[id as typeof operationIds[number]]; return { id, version: value.version, inputSchema: z.toJSONSchema(value.input), capability: value.capability, retry: value.retry, effect: value.effect }; }
          return { apiVersion: "2.0.0", capabilities: blockRegistryCapabilities, components: componentCatalog().map(({ id, version }) => ({ id, version })), baseTypes: createBlockRegistry().list().map(({ id, version, title, family }) => ({ id, version, title, family })), operations: operationIds.map((id) => ({ id, version: operationCatalog[id].version, capability: operationCatalog[id].capability, effect: operationCatalog[id].effect })), development: "Inspect contracts on demand → create/patch draft at expectedRevision → validate → preview → fixture trial → user publish/enable. Host code is disabled. Nested methods use core.subflow with an exact embedded definition." };
        }
        case "liteasy_extension_drafts": return (await input.drafts.list()).map(({ id, title, revision }) => ({ id, title, revision }));
        case "liteasy_extension_draft": return input.drafts.get((args as { id: string }).id);
        case "liteasy_extension_create": {
          const options = studioTools.liteasy_extension_create.schema.parse(args);
          return input.drafts.create(options.title, options.files ?? (await paperLensPackage()).files, options.description);
        }
        case "liteasy_extension_patch": { const options = studioTools.liteasy_extension_patch.schema.parse(args); return input.drafts.patch(options.id, options.expectedRevision, options.changes, "ai"); }
        case "liteasy_extension_validate": { const pkg = await input.drafts.validate((args as { id: string }).id); return { valid: true, digest: pkg.digest, manifest: pkg.manifest }; }
        case "liteasy_extension_trial": { const id = (args as { id: string }).id; const report = await trialExtension(await input.drafts.get(id), () => input.active() && !policy.signal?.aborted, input.repository.scopeId); await input.drafts.saveReport(id, report); return report; }
        case "liteasy_extension_export": return buildExtensionPackage((await input.drafts.get((args as { id: string }).id)).files);
        case "liteasy_workflow_runs": return (await input.runner.list()).map(({ id, owner, status, createdAt, definition }) => ({ id, owner, status, createdAt, title: definition.title }));
        case "liteasy_workflow_recompute": return input.runner.recompute((args as { id: string }).id);
        case "liteasy_workflow_replay": return input.runner.replay((args as { id: string }).id);
        case "liteasy_block_read": {
          const { path } = studioTools.liteasy_block_read.schema.parse(args), target = parseLiteasyPath(path, input.repository.scopeId);
          if (target.kind !== "object") throw new Error("请选择结构化内容块。");
          const object = target.followLatest ? await input.repository.resolveLatest(target.ref.objectId) : await input.repository.get(target.ref);
          const block = await input.repository.getStructuredBlock(refOf(object)); if (!block) throw new Error("目标不是结构化内容块。");
          return { path, title: object.title, revision: object.revision, block, fallback: objectText(object) };
        }
        case "liteasy_block_create": {
          const options = studioTools.liteasy_block_create.schema.parse(args);
          const registry = (await input.packages.active()).registry;
          const data = registry.instantiate(options.typeId, options.typeVersion, options.data as JsonObject);
          let board;
          if (options.boardPath) { const target = parseLiteasyPath(options.boardPath, input.repository.scopeId); if (target.kind !== "object") throw new Error("请选择白板资产。"); board = await input.repository.resolveLatest(target.ref.objectId); if (board.kind !== "workspace.board") throw new Error("目标不是白板。"); }
          const object = await input.repository.createStructuredBlock({ title: options.title, text: projectBlockText(data), block: { schema: "liteasy.visual-block/v1", type: { id: options.typeId, version: options.typeVersion }, data }, boardRef: board ? refOf(board) : undefined, position: { x: options.x, y: options.y }, operationId: options.operationId });
          await input.refresh(); return { title: object.title, path: liteasyPath(input.repository.scopeId, { kind: "object", ref: refOf(object) }), revision: object.revision };
        }
        case "liteasy_block_update": {
          const options = studioTools.liteasy_block_update.schema.parse(args), target = parseLiteasyPath(options.path, input.repository.scopeId);
          if (target.kind !== "object") throw new Error("请选择结构化内容块。");
          const object = await input.repository.get({ objectId: target.ref.objectId, revision: options.expectedRevision });
          const block = await input.repository.getStructuredBlock(refOf(object)); if (!block) throw new Error("此资产不是结构化内容块。");
          const data = (await input.packages.active()).registry.instantiate(block.type.id, block.type.version, options.data as JsonObject);
          const next = await input.repository.updateStructuredBlock({ ref: refOf(object), title: options.title, text: projectBlockText(data), block: { ...block, data }, operationId: options.operationId });
          await input.refresh(); return { title: next.title, path: liteasyPath(input.repository.scopeId, { kind: "object", ref: refOf(next) }), revision: next.revision };
        }
      }
    },
  };
}
export type ExtensionStudioService = ReturnType<typeof createExtensionStudioService>;
