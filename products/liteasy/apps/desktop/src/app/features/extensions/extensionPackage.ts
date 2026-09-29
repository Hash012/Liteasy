import { z } from "zod";
import { hashText } from "../context/objectContext";
import { boundedJson, parseDataSchema, schemaDefaults, validateSchemaValue, type DataSchema } from "./extensionSchema";
import { blockTypeId, blockVersion, createBlockRegistry, parseBlockDefinition, validateComponentTree, type DerivedBlockDefinition } from "../visual-blocks/blockRegistry";

const localId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9.-]*$/).max(80);
export const extensionId = z.string().regex(/^plugin\.[a-z0-9][a-z0-9.-]*$/).max(80);
const relativePath = z.string().min(1).max(240).refine((path) => !/[:\\\x00-\x1f]/.test(path) && path.split("/").every((part) => part && part !== "." && part !== ".." && !/[. ]$/.test(part)), "包路径无效。");
const contribution = z.strictObject({ id: localId, path: relativePath });
export const extensionPermissionSchema = z.strictObject({ capability: z.enum(["resources.metadata.read", "resources.content.read", "resources.create", "resources.write", "model.invoke", "network.request"]), scopeRef: z.enum(["invocation.selection", "invocation.output", "invocation.modelConnection", "invocation.network"]), kinds: z.array(z.string().max(80)).max(30).optional() });
export const extensionManifestSchema = z.strictObject({
  apiVersion: z.literal("liteasy.extension/v2"), id: extensionId, name: z.string().min(1).max(120), version: blockVersion,
  engines: z.strictObject({ extensionApi: z.enum(["2.0.0", ">=2.0.0 <3.0.0"]) }),
  activationEvents: z.array(z.string().max(160)).max(100).default([]),
  permissions: z.array(extensionPermissionSchema).max(30).default([]),
  contributes: z.strictObject({
    blockTypes: z.array(contribution).max(50).default([]), boardTemplates: z.array(contribution).max(30).default([]),
    views: z.array(z.strictObject({ id: localId, title: z.string().min(1).max(120), icon: z.string().max(80).default("BoardRegular"), placement: z.enum(["main", "left", "right", "bottom"]).default("main"), allowedPlacements: z.array(z.enum(["main", "left", "right", "bottom"])).optional(), entry: z.strictObject({ kind: z.literal("declarative"), path: relativePath }), argsSchema: relativePath.optional(), stateSchema: relativePath.optional(), instancePolicy: z.enum(["singleton", "per-resource", "per-resource-set", "multiple"]).default("singleton") })).max(30).default([]),
    settings: z.array(z.strictObject({ id: localId, title: z.string().min(1).max(120), category: z.enum(["extensions", "reading", "ai"]).default("extensions"), schema: relativePath })).max(30).default([]),
    commands: z.array(z.strictObject({ id: localId, title: z.string().min(1).max(120), workflow: localId.optional(), view: localId.optional(), boardTemplate: localId.optional() }).refine((value) => [value.workflow, value.view, value.boardTemplate].filter(Boolean).length === 1)).max(50).default([]),
    menus: z.array(z.strictObject({ location: z.enum(["library.item.context", "reader.selection", "board.context"]), command: localId, when: z.strictObject({ op: z.literal("gte"), left: z.strictObject({ context: z.enum(["selection.paperCount", "selection.resourceCount"]) }), right: z.number().int().min(0).max(1000) }).optional() })).max(50).default([]),
    workflows: z.array(contribution).max(30).default([]), skills: z.array(contribution).max(30).default([]),
  }),
});
export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;
export const boardTemplateSchema = z.strictObject({
  schema: z.literal("liteasy.board-template/v1"), id: localId, title: z.string().min(1).max(120),
  cards: z.array(z.strictObject({ id: localId, title: z.string().max(120), type: z.strictObject({ id: blockTypeId, version: blockVersion }), data: z.record(z.string(), z.json()), position: z.strictObject({ x: z.number().min(0).max(100000), y: z.number().min(0).max(100000) }), size: z.strictObject({ width: z.number().min(120).max(8000), height: z.number().min(80).max(8000) }) })).min(1).max(200),
});
export type BoardTemplate = z.infer<typeof boardTemplateSchema>;
const bundleSchema = z.strictObject({ format: z.literal("liteasy.extension-package/v1"), files: z.record(relativePath, z.string()), digests: z.record(relativePath, z.string().regex(/^[a-f0-9]{64}$/)) });
export type ExtensionPackage = z.infer<typeof bundleSchema>;
export type ValidatedExtension = { bundle: ExtensionPackage; digest: string; manifest: ExtensionManifest; blocks: DerivedBlockDefinition[]; templates: BoardTemplate[]; settings: Record<string, DataSchema> };

export async function buildExtensionPackage(files: Record<string, string>): Promise<ExtensionPackage> {
  const digests = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([path, text]) => [path, await hashText(text)])));
  return bundleSchema.parse({ format: "liteasy.extension-package/v1", files, digests });
}

export async function validateExtensionPackage(input: unknown): Promise<ValidatedExtension> {
  boundedJson(input, 24 * 1024 * 1024);
  const bundle = bundleSchema.parse(input);
  const paths = Object.keys(bundle.files);
  if (paths.length > 200 || new Set(paths.map((path) => path.toLowerCase())).size !== paths.length) throw new Error("包文件过多或名称仅大小写不同。");
  if (Object.keys(bundle.digests).sort().join("\n") !== [...paths].sort().join("\n")) throw new Error("文件摘要目录不一致。");
  let total = 0;
  for (const path of paths) {
    const bytes = new TextEncoder().encode(bundle.files[path]).length;
    total += bytes;
    if (bytes > 5 * 1024 * 1024 || total > 20 * 1024 * 1024) throw new Error("扩展包超过文件大小限制。");
    if (await hashText(bundle.files[path]) !== bundle.digests[path]) throw new Error(`文件摘要不符：${path}`);
    if (!/\.(json|md|txt|svg)$/i.test(path)) throw new Error("此版本只启用声明式扩展；可执行代码尚未通过隔离验收。");
  }
  const read = (path: string) => {
    if (!Object.prototype.hasOwnProperty.call(bundle.files, path)) throw new Error(`缺少包文件：${path}`);
    try { return JSON.parse(bundle.files[path]) as unknown; } catch { throw new Error(`文件不是有效 JSON：${path}`); }
  };
  const manifest = extensionManifestSchema.parse(read("liteasy.extension.json"));
  for (const [kind, items] of Object.entries(manifest.contributes)) {
    if (kind === "menus") continue;
    const ids = (items as Array<{ id: string }>).map((item) => item.id);
    if (new Set(ids).size !== ids.length) throw new Error(`贡献 ID 重复：${kind}`);
  }
  const blocks = manifest.contributes.blockTypes.map((item) => {
    const definition = parseBlockDefinition(read(item.path), manifest.id);
    if (definition.id !== `${manifest.id}/${item.id}`) throw new Error("组件入口与声明 ID 不一致。");
    return definition;
  });
  const registry = createBlockRegistry(blocks);
  const templates = manifest.contributes.boardTemplates.map((item) => {
    const template = boardTemplateSchema.parse(read(item.path));
    if (template.id !== item.id || new Set(template.cards.map((card) => card.id)).size !== template.cards.length) throw new Error("模板 ID 无效或卡片 ID 重复。");
    for (const card of template.cards) registry.instantiate(card.type.id, card.type.version, card.data);
    return template;
  });
  const settings: Record<string, DataSchema> = {};
  for (const item of manifest.contributes.settings) {
    const schema = parseDataSchema(read(item.schema));
    if (schema.type !== "object") throw new Error("设置必须使用对象 schema。");
    validateSchemaValue(schema, schemaDefaults(schema)); settings[item.id] = schema;
  }
  for (const view of manifest.contributes.views) {
    validateComponentTree(read(view.entry.path));
    for (const path of [view.argsSchema, view.stateSchema]) if (path) parseDataSchema(read(path));
  }
  for (const item of [...manifest.contributes.workflows, ...manifest.contributes.skills]) boundedJson(read(item.path));
  for (const command of manifest.contributes.commands) {
    if (command.workflow && !manifest.contributes.workflows.some((item) => item.id === command.workflow) || command.view && !manifest.contributes.views.some((item) => item.id === command.view) || command.boardTemplate && !templates.some((item) => item.id === command.boardTemplate)) throw new Error("命令引用不存在的贡献。");
  }
  for (const menu of manifest.contributes.menus) if (!manifest.contributes.commands.some((command) => command.id === menu.command)) throw new Error("菜单引用不存在的命令。");
  const digest = await hashText(JSON.stringify(paths.sort().map((path) => [path, bundle.digests[path]])));
  return { bundle, digest, manifest, blocks, templates, settings };
}
