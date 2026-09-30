import { z } from "zod";
import { boundedJson, parseDataSchema, schemaDefaults, validateSchemaValue, type DataSchema, type JsonObject, type JsonValue } from "../extensions/extensionSchema";

export const blockVersion = z.string().regex(/^\d+\.\d+\.\d+$/);
export const blockTypeId = z.string().regex(/^(?:liteasy|plugin\.[a-z0-9][a-z0-9.-]*)\/[a-zA-Z][a-zA-Z0-9.-]*$/).max(160);
export const componentNames = ["Stack", "Grid", "Card", "MarkdownView", "Image", "ResourceCard", "Table", "Divider", "Split", "Toolbar", "Tabs", "Status", "EmptyState", "Field", "Dialog", "EvidenceCard", "CitationList", "Timeline", "TreeOutline", "Visualization", "MarkdownEditor", "ResourcePicker"] as const;
export type BlockComponent = typeof componentNames[number];
export type ComponentTree = { component: BlockComponent; props?: Record<string, JsonValue>; children?: ComponentTree[] };
export type DerivedBlockDefinition = {
  id: string; version: string; title: string; base: { id: string; version: string };
  dataSchema: DataSchema; defaults: JsonObject; template?: ComponentTree;
};
export type ResolvedBlockType = { id: string; version: string; title: string; family: string; dataSchema: DataSchema; defaults: JsonObject; templates: ComponentTree[] };
const baseSchema: DataSchema = { type: "object", properties: { text: { type: "string", maxLength: 100000, default: "" } }, required: ["text"], additionalProperties: false };
export const builtinBlockTypes: ResolvedBlockType[] = ["RichTextBlock", "MediaBlock", "ResourceBlock", "CollectionBlock", "GroupBlock"].map((family): ResolvedBlockType => {
  const properties: Record<string, DataSchema> = { ...baseSchema.properties };
  if (family === "MediaBlock") properties.image = { type: "string", maxLength: 8192, default: "" };
  if (family === "ResourceBlock") properties.path = { type: "string", maxLength: 8192, default: "" };
  if (family === "CollectionBlock") properties.rows = { type: "array", maxItems: 200, items: { type: "array", maxItems: 12, items: { type: "string", maxLength: 8000 } }, default: [] };
  const dataSchema = { ...baseSchema, properties };
  return { id: `liteasy/${family}`, version: "1.0.0", title: ({ RichTextBlock: "富内容", MediaBlock: "图片", ResourceBlock: "资源引用", CollectionBlock: "对照表", GroupBlock: "分组" } as Record<string, string>)[family], family, dataSchema, defaults: schemaDefaults(dataSchema) as JsonObject,
    templates: [{ component: "MarkdownView", props: { text: { $field: "text" } } }, ...(family === "MediaBlock" ? [{ component: "Image" as const, props: { source: { $field: "image" } } }] : family === "ResourceBlock" ? [{ component: "ResourceCard" as const, props: { path: { $field: "path" } } }] : family === "CollectionBlock" ? [{ component: "Table" as const, props: { rows: { $field: "rows" } } }] : [])] };
});

const componentProps: Record<BlockComponent, string[]> = { Stack: ["gap"], Grid: ["columns", "gap"], Card: ["title"], MarkdownView: ["text"], Image: ["source", "alt"], ResourceCard: ["path", "title"], Table: ["rows"], Divider: [], Split: [], Toolbar: ["title"], Tabs: ["labels"], Status: ["title", "text"], EmptyState: ["title", "text"], Field: ["title", "text"], Dialog: ["title"], EvidenceCard: ["title", "text", "source"], CitationList: ["title", "items"], Timeline: ["title", "items"], TreeOutline: ["title", "items"], Visualization: ["artifact"], MarkdownEditor: ["path"], ResourcePicker: [] };
const fieldBinding = z.strictObject({ $field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/).max(240) });
const bindable = <T extends z.ZodType>(schema: T) => z.union([schema, fieldBinding]);
const componentSchemas = {
  Stack: z.strictObject({ gap: bindable(z.number().min(0).max(32)).optional() }),
  Grid: z.strictObject({ columns: bindable(z.number().int().min(1).max(6)).optional(), gap: bindable(z.number().min(0).max(32)).optional() }),
  Card: z.strictObject({ title: bindable(z.string().max(2000)).optional() }),
  MarkdownView: z.strictObject({ text: bindable(z.string().max(100000)) }),
  Image: z.strictObject({ source: bindable(z.string().max(8192)), alt: bindable(z.string().max(2000)).optional() }),
  ResourceCard: z.strictObject({ path: bindable(z.string().max(8192)), title: bindable(z.string().max(2000)).optional() }),
  Table: z.strictObject({ rows: bindable(z.array(z.array(z.string().max(8000)).max(12)).max(200)) }),
  Divider: z.strictObject({}), Split: z.strictObject({}), ResourcePicker: z.strictObject({}),
  Toolbar: z.strictObject({ title: bindable(z.string().max(120)).optional() }),
  Tabs: z.strictObject({ labels: bindable(z.array(z.string().max(120)).min(1).max(12)) }),
  Status: z.strictObject({ title: bindable(z.string().max(120)).optional(), text: bindable(z.string().max(8000)) }),
  EmptyState: z.strictObject({ title: bindable(z.string().max(120)).optional(), text: bindable(z.string().max(8000)) }),
  Field: z.strictObject({ title: bindable(z.string().max(120)), text: bindable(z.string().max(8000)) }),
  Dialog: z.strictObject({ title: bindable(z.string().min(1).max(120)) }),
  EvidenceCard: z.strictObject({ title: bindable(z.string().max(120)), text: bindable(z.string().max(80000)), source: bindable(z.string().max(8192)) }),
  CitationList: z.strictObject({ title: bindable(z.string().max(120)).optional(), items: bindable(z.array(z.string().max(8000)).max(200)) }),
  Timeline: z.strictObject({ title: bindable(z.string().max(120)).optional(), items: bindable(z.array(z.string().max(8000)).max(200)) }),
  TreeOutline: z.strictObject({ title: bindable(z.string().max(120)).optional(), items: bindable(z.array(z.string().max(8000)).max(200)) }),
  Visualization: z.strictObject({ artifact: bindable(z.json()) }),
  MarkdownEditor: z.strictObject({ path: bindable(z.string().max(8192)) }),
};
export function componentCatalog() { return componentNames.map((id) => ({ id, version: "1.0.0", propsSchema: z.toJSONSchema(componentSchemas[id]), surfaces: ["board", "page", "preview"], keyboard: "Tab traverses host actions; Enter opens links; card handles provide arrow-key movement.", capabilities: ["theme", "typography", "readable-fallback"], budget: { maxTreeNodes: 200, maxDepth: 12 }, events: id === "ResourceCard" || id === "ResourcePicker" ? { open: { path: "LiteasyPath" } } : id === "Tabs" ? { select: { index: "integer" } } : {}, themeTokens: ["colorNeutralForeground1", "colorNeutralBackground1", "colorNeutralStroke2"], fallback: "readable structured data", export: ["markdown", "json"], example: id === "MarkdownView" ? { component: id, props: { text: "$x^2$" } } : id === "Image" ? { component: id, props: { source: { $field: "image" }, alt: "证据图" } } : { component: id, props: Object.fromEntries(componentProps[id].map((key) => [key, { $field: key }])) } })); }
export function validateComponentTree(value: unknown, fields?: Set<string>): ComponentTree {
  boundedJson(value, 64 * 1024);
  let count = 0;
  function visit(raw: unknown, depth: number): ComponentTree {
    if (++count > 200 || depth > 12 || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("组件树过大或无效。");
    const node = raw as ComponentTree;
    if (!componentNames.includes(node.component) || Object.keys(node).some((key) => !["component", "props", "children"].includes(key))) throw new Error("存在未注册的组件或属性。");
    if (node.props && (typeof node.props !== "object" || Array.isArray(node.props))) throw new Error("组件属性必须是对象。");
    for (const [key, prop] of Object.entries(node.props ?? {})) {
      if (!componentProps[node.component].includes(key)) throw new Error(`组件 ${node.component} 不支持属性 ${key}。`);
      if (prop && typeof prop === "object" && !Array.isArray(prop) && "$field" in prop) {
        if (Object.keys(prop).length !== 1 || typeof prop.$field !== "string" || (fields && !fields.has(prop.$field))) throw new Error("组件绑定指向未知字段。");
      }
    }
    componentSchemas[node.component].parse(node.props ?? {});
    if (node.children && !Array.isArray(node.children)) throw new Error("children 必须是数组。");
    node.children?.forEach((child) => visit(child, depth + 1)); return node;
  }
  return visit(value, 0);
}

export function parseBlockDefinition(value: unknown, owner: string): DerivedBlockDefinition {
  boundedJson(value);
  const raw = z.strictObject({ id: blockTypeId, version: blockVersion, title: z.string().min(1).max(120), base: z.strictObject({ id: blockTypeId, version: blockVersion }), dataSchema: z.unknown(), defaults: z.record(z.string(), z.json()).default({}), template: z.unknown().optional() }).parse(value);
  if (!raw.id.startsWith(`${owner}/`)) throw new Error("组件必须使用本扩展的命名空间。");
  const dataSchema = parseDataSchema(raw.dataSchema);
  if (dataSchema.type !== "object") throw new Error("组件的数据 schema 必须是对象。");
  return { ...raw, dataSchema, ...(raw.template ? { template: validateComponentTree(raw.template) } : { template: undefined }) };
}

export function createBlockRegistry(definitions: DerivedBlockDefinition[] = []) {
  const resolved = new Map(builtinBlockTypes.map((item) => [`${item.id}@${item.version}`, item]));
  const pending = new Map<string, DerivedBlockDefinition>();
  for (const definition of definitions) {
    const key = `${definition.id}@${definition.version}`;
    if (pending.has(key) && JSON.stringify(pending.get(key)) === JSON.stringify(definition)) continue;
    if (pending.has(key) || resolved.has(key)) throw new Error(`组件重复：${key}`);
    pending.set(key, definition);
  }
  function resolve(id: string, version: string, chain = new Set<string>()): ResolvedBlockType {
    const key = `${id}@${version}`;
    if (resolved.has(key)) return resolved.get(key)!;
    if (chain.has(key) || chain.size > 12) throw new Error("组件派生存在循环或层级过深。");
    const definition = pending.get(key);
    if (!definition) throw new Error(`缺少组件版本：${key}`);
    const parent = resolve(definition.base.id, definition.base.version, new Set([...chain, key]));
    const properties = { ...parent.dataSchema.properties };
    for (const [field, schema] of Object.entries(definition.dataSchema.properties ?? {})) {
      if (properties[field] && JSON.stringify(properties[field]) !== JSON.stringify(schema)) throw new Error(`派生类型不能覆盖基类字段：${field}`);
      properties[field] = schema;
    }
    const dataSchema: DataSchema = { type: "object", properties, required: [...new Set([...(parent.dataSchema.required ?? []), ...(definition.dataSchema.required ?? [])])], additionalProperties: false };
    if (definition.template) validateComponentTree(definition.template, new Set(Object.keys(properties)));
    const defaults = { ...schemaDefaults(dataSchema) as JsonObject, ...parent.defaults, ...definition.defaults };
    validateSchemaValue(dataSchema, defaults);
    const result = { id, version, title: definition.title, family: parent.family, dataSchema, defaults, templates: [...parent.templates, ...(definition.template ? [definition.template] : [])] };
    resolved.set(key, result); return result;
  }
  for (const definition of definitions) resolve(definition.id, definition.version);
  return { resolve, list: () => [...resolved.values()], instantiate(id: string, version: string, data: JsonObject) { const type = resolve(id, version); return validateSchemaValue(type.dataSchema, { ...type.defaults, ...data }) as JsonObject; } };
}

export function projectBlockText(data: JsonObject): string {
  return Object.entries(data).map(([key, value]) => key === "text" && typeof value === "string" ? value : `### ${key}\n\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`).filter(Boolean).join("\n\n");
}

export const blockRegistryCapabilities = ["typography", "markdown", "math", "diagram", "images", "liteasy-path", "drag", "context", "versioned-content", "independent-layout", "readable-fallback"] as const;
