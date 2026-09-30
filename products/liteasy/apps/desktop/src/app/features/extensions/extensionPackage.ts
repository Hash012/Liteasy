import { extensionSkillSchema } from "./extensionSkill";
import { compileWorkflow } from "../workflows/workflowDefinition";
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
  dependencies: z.array(z.strictObject({ id: extensionId, version: blockVersion, digest: z.string().regex(/^[a-f0-9]{64}$/), path: relativePath })).max(16).default([]),
  activationEvents: z.array(z.string().max(160)).max(100).default([]),
  permissions: z.array(extensionPermissionSchema).max(30).default([]),
  contributes: z.strictObject({
    libraryColumns: z.array(z.strictObject({ id: localId, title: z.string().min(1).max(80), field: z.enum(["title", "authors", "year", "publication", "doi", "subjects", "format", "collection"]), prefix: z.string().max(40).optional() })).max(12).default([]),
    metadataSections: z.array(z.strictObject({ id: localId, title: z.string().min(1).max(120), path: relativePath })).max(8).default([]),
    blockTypes: z.array(contribution).max(50).default([]), boardTemplates: z.array(contribution).max(30).default([]),
    views: z.array(z.strictObject({ id: localId, title: z.string().min(1).max(120), icon: z.string().max(80).default("BoardRegular"), placement: z.enum(["main", "left", "right", "bottom"]).default("main"), allowedPlacements: z.array(z.enum(["main", "left", "right", "bottom"])).optional(), entry: z.strictObject({ kind: z.literal("declarative"), path: relativePath }), argsSchema: relativePath.optional(), stateSchema: relativePath.optional(), instancePolicy: z.enum(["singleton", "per-resource", "per-resource-set", "multiple"]).default("singleton") })).max(30).default([]),
    settings: z.array(z.strictObject({ id: localId, title: z.string().min(1).max(120), category: z.enum(["extensions", "reading", "ai"]).default("extensions"), schema: relativePath })).max(30).default([]),
    commands: z.array(z.strictObject({ id: localId, title: z.string().min(1).max(120), workflow: localId.optional(), view: localId.optional(), boardTemplate: localId.optional() }).refine((value) => [value.workflow, value.view, value.boardTemplate].filter(Boolean).length === 1)).max(50).default([]),
    menus: z.array(z.strictObject({ location: z.enum(["library.item.context", "reader.selection", "board.context"]), command: localId, when: z.strictObject({ op: z.literal("gte"), left: z.strictObject({ context: z.enum(["selection.paperCount", "selection.resourceCount"]) }), right: z.number().int().min(0).max(1000) }).optional() })).max(50).default([]),
    operators: z.array(contribution).max(30).default([]),
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
export type ValidatedExtension = { bundle: ExtensionPackage; digest: string; manifest: ExtensionManifest; blocks: DerivedBlockDefinition[]; templates: BoardTemplate[]; settings: Record<string, DataSchema>; dependencies: ValidatedExtension[] };

export async function buildExtensionPackage(files: Record<string, string>): Promise<ExtensionPackage> {
  const digests = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([path, text]) => [path, await hashText(text)])));
  return bundleSchema.parse({ format: "liteasy.extension-package/v1", files, digests });
}

export async function validateExtensionPackage(input: unknown, owners: string[] = []): Promise<ValidatedExtension> {
  if (owners.length > 4) throw new Error("包依赖不能超过四层。");
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
  if (owners.includes(manifest.id)) throw new Error("包依赖存在循环。");
  const dependencies: ValidatedExtension[] = [];
  for (const dependency of manifest.dependencies) {
    const pkg = await validateExtensionPackage(read(dependency.path), [...owners, manifest.id]);
    if (pkg.manifest.id !== dependency.id || pkg.manifest.version !== dependency.version || pkg.digest !== dependency.digest) throw new Error("依赖包身份、精确版本或摘要不符。");
    dependencies.push(pkg);
  }
  const ownBlocks = manifest.contributes.blockTypes.map((item) => {
    const definition = parseBlockDefinition(read(item.path), manifest.id);
    if (definition.id !== `${manifest.id}/${item.id}`) throw new Error("组件入口与声明 ID 不一致。");
    return definition;
  });
  const definitions = new Map<string, DerivedBlockDefinition>();
  for (const block of [...dependencies.flatMap((pkg) => pkg.blocks), ...ownBlocks]) {
    const key = `${block.id}@${block.version}`, prior = definitions.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(block)) throw new Error(`依赖组件存在冲突：${key}`);
    definitions.set(key, block);
  }
  const blocks = [...definitions.values()], registry = createBlockRegistry(blocks);
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
  for (const section of manifest.contributes.metadataSections) validateComponentTree(read(section.path), new Set(["title", "authors", "year", "publication", "doi", "subjects", "format", "collection", "summary"]));
  for (const view of manifest.contributes.views) {
    validateComponentTree(read(view.entry.path));
    for (const path of [view.argsSchema, view.stateSchema]) if (path) parseDataSchema(read(path));
  }
  for (const item of manifest.contributes.operators) compileWorkflow(expandPackageOperators(read(item.path), manifest, bundle.files));
  for (const item of manifest.contributes.workflows) { const plan = compileWorkflow(expandPackageOperators(read(item.path), manifest, bundle.files)); if (plan.definition.id !== item.id) throw new Error("工作流 ID 与声明不一致。"); if (plan.capabilities.some((capability) => !manifest.permissions.some((permission) => permission.capability === capability))) throw new Error("工作流能力声明不完整。"); }
  for (const item of manifest.contributes.skills) { const skill = extensionSkillSchema.parse(read(item.path)); const workflow = manifest.contributes.workflows.find((workflow) => workflow.id === skill.workflow.id); if (skill.id !== item.id || !workflow || compileWorkflow(expandPackageOperators(read(workflow.path), manifest, bundle.files)).definition.version !== skill.workflow.version) throw new Error("skill 必须引用已声明的精确工作流版本。"); }
  for (const command of manifest.contributes.commands) {
    if (command.workflow && !manifest.contributes.workflows.some((item) => item.id === command.workflow) || command.view && !manifest.contributes.views.some((item) => item.id === command.view) || command.boardTemplate && !templates.some((item) => item.id === command.boardTemplate)) throw new Error("命令引用不存在的贡献。");
  }
  for (const menu of manifest.contributes.menus) if (!manifest.contributes.commands.some((command) => command.id === menu.command)) throw new Error("菜单引用不存在的命令。");
  if (bundle.files["extension.lock.json"]) {
    const lock = z.strictObject({ schema: z.literal("liteasy.extension-lock/v1"), extensionId: extensionId, version: blockVersion, sourceDigest: z.string(), extensionApi: z.literal("2.0.0"), files: z.record(z.string(), z.string()), components: z.array(z.json()), workflows: z.array(z.strictObject({ id: z.string(), digest: z.string() })) }).parse(read("extension.lock.json"));
    const sourcePaths = paths.filter((path) => !["extension.lock.json", "tests/report.json"].includes(path)).sort();
    const expected = Object.fromEntries(sourcePaths.map((path) => [path, bundle.digests[path]]));
    if (lock.extensionId !== manifest.id || lock.version !== manifest.version || Object.keys(lock.files).sort().join("\n") !== sourcePaths.join("\n") || sourcePaths.some((path) => lock.files[path] !== expected[path]) || lock.sourceDigest !== await hashText(JSON.stringify(sourcePaths.map((path) => [path, expected[path]])))) throw new Error("发布锁与实际包内容不一致。");
    if (JSON.stringify(lock.components) !== JSON.stringify(blocks.map((block) => ({ id: block.id, version: block.version, base: block.base })))) throw new Error("组件版本锁不匹配。");
    if (lock.workflows.length !== manifest.contributes.workflows.length) throw new Error("工作流版本锁不完整。");
    for (const workflow of manifest.contributes.workflows) if (lock.workflows.find((entry) => entry.id === workflow.id)?.digest !== await hashText(bundle.files[workflow.path])) throw new Error("工作流版本锁不匹配。");
  }
  const digest = await hashText(JSON.stringify(paths.sort().map((path) => [path, bundle.digests[path]])));
  return { bundle, digest, manifest, blocks, templates, settings, dependencies };
}

/** Declarative contributed operations use an exact embedded workflow and one typed object input.
 * Expansion pins the full definition in each run, so uninstall/upgrade cannot alter a saved plan.
 */
export function expandPackageOperators(value: unknown, manifest: ExtensionManifest, files: Record<string, string>, chain: string[] = []): unknown {
  boundedJson(value);
  if (!value || typeof value !== "object" || !Array.isArray((value as { nodes?: unknown[] }).nodes)) return value;
  const flow = value as { nodes: Array<{ operation?: { id?: string; version?: string }; input?: Record<string, unknown> }> };
  return { ...flow, nodes: flow.nodes.map((node) => {
    const id = node.operation?.id;
    if (!id?.startsWith("plugin.")) return node;
    if (!id.startsWith(`${manifest.id}/`)) {
      const dependency = manifest.dependencies.find((item) => id.startsWith(`${item.id}/`));
      if (!dependency) throw new Error(`未声明依赖算子：${id}`);
      const bundle = JSON.parse(files[dependency.path]) as ExtensionPackage;
      const dependencyManifest = extensionManifestSchema.parse(JSON.parse(bundle.files["liteasy.extension.json"]));
      return (expandPackageOperators({ nodes: [node] }, dependencyManifest, bundle.files, chain) as { nodes: unknown[] }).nodes[0];
    }
    const entry = manifest.contributes.operators.find((item) => `${manifest.id}/${item.id}` === id);
    if (!entry || chain.includes(id) || chain.length >= 4) throw new Error(`算子缺失或递归依赖：${id}`);
    const child = JSON.parse(files[entry.path]) as { version?: string };
    if (child.version !== node.operation?.version) throw new Error(`算子精确版本不符：${id}`);
    if (!node.input?.value || Object.keys(node.input).some((key) => key !== "value")) throw new Error(`算子 ${id} 使用单个 value 对象参数。`);
    return { ...node, operation: { id: "core.subflow", version: "1.0.0" }, input: { value: node.input.value, definition: { source: "literal", value: expandPackageOperators(child, manifest, files, [...chain, id]) } } };
  }) };
}
export function compileExtensionWorkflow(pkg: Pick<ValidatedExtension, "manifest" | "bundle">, path: string) {
  return compileWorkflow(expandPackageOperators(JSON.parse(pkg.bundle.files[path]), pkg.manifest, pkg.bundle.files));
}
