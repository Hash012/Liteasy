import { expandSubflows } from "./workflowSubflows";
import { z } from "zod";
import { boundedJson, parseDataSchema, validateSchemaValue, type JsonObject, type JsonValue } from "../extensions/extensionSchema";
import { operationCatalog, operationIds, type OperationId } from "./operationCatalog";
const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9.-]{0,79}$/);
export const bindingSchema = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("literal"), value: z.json() }),
  z.strictObject({ source: z.literal("input"), path: z.string().max(240) }),
  z.strictObject({ source: z.literal("settings"), path: z.string().max(240) }),
  z.strictObject({ source: z.literal("node"), nodeId: id, path: z.string().max(240).default("") }),
]);
export type WorkflowBinding = z.infer<typeof bindingSchema>;
export const workflowSchema = z.strictObject({
  schema: z.literal("liteasy.workflow/v2"), id, title: z.string().min(1).max(120), version: z.string().regex(/^\d+\.\d+\.\d+$/),
  inputSchema: z.json(), outputSchema: z.json(),
  nodes: z.array(z.strictObject({ id, title: z.string().max(120), operation: z.strictObject({ id: z.enum(operationIds as [OperationId, ...OperationId[]]), version: z.literal("1.0.0") }), input: z.record(z.string(), bindingSchema), retries: z.number().int().min(0).max(2).default(0), breakpoint: z.boolean().default(false),
    map: z.strictObject({ items: bindingSchema, itemField: id, maxItems: z.number().int().min(1).max(100), concurrency: z.number().int().min(1).max(2).default(1) }).optional(),
  })).min(1).max(100),
  edges: z.array(z.strictObject({ from: id, to: id, when: z.boolean().optional() })).max(400).default([]),
  output: bindingSchema,
  budget: z.strictObject({ maxMilliseconds: z.number().int().min(100).max(3600000).default(300000), maxOperations: z.number().int().min(1).max(400).default(100), maxModelCalls: z.number().int().min(0).max(30).default(3), maxTokens: z.number().int().min(0).max(200000).default(32000), concurrency: z.number().int().min(1).max(2).default(1) }).default({ maxMilliseconds: 300000, maxOperations: 100, maxModelCalls: 3, maxTokens: 32000, concurrency: 1 }),
  layout: z.record(z.string(), z.strictObject({ x: z.number().finite(), y: z.number().finite() })).default({}),
});
export type WorkflowDefinition = z.infer<typeof workflowSchema>;
export function compileWorkflow(value: unknown) {
  boundedJson(value);
  const definition = workflowSchema.parse(expandSubflows(value));
  const inputSchema = parseDataSchema(definition.inputSchema), outputSchema = parseDataSchema(definition.outputSchema);
  if (inputSchema.type !== "object") throw new Error("inputSchema: 工作流参数必须是对象。");
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  if (nodes.size !== definition.nodes.length) throw new Error("nodes: 节点 ID 重复。");
  const dependencies = new Map(definition.nodes.map((node) => [node.id, new Set<string>()]));
  const validateBinding = (binding: WorkflowBinding, nodeId?: string) => {
    if (binding.source === "literal") return;
    if (binding.path.split(".").some((part) => ["__proto__", "constructor", "prototype"].includes(part))) throw new Error("binding: 保留字段不可引用。");
    if (binding.source === "input" && binding.path && !Object.prototype.hasOwnProperty.call(inputSchema.properties ?? {}, binding.path.split(".")[0])) throw new Error(`binding: 输入字段不存在 ${binding.path}`);
    if (binding.source === "node") {
      if (!nodes.has(binding.nodeId)) throw new Error(`binding: 节点不存在 ${binding.nodeId}`);
      if (nodeId) dependencies.get(nodeId)!.add(binding.nodeId);
    }
  };
  for (const edge of definition.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) throw new Error("edge: 节点不存在。");
    if (edge.when !== undefined && nodes.get(edge.from)!.operation.id !== "core.branch") throw new Error("edge.when: 仅条件节点可分支。");
    dependencies.get(edge.to)!.add(edge.from);
  }
  for (const node of definition.nodes) {
    const operator = operationCatalog[node.operation.id];
    if (node.retries && operator.retry === "never") throw new Error(`${node.id}: 操作不允许自动重试。`);
    const fields = operator.input.shape;
    for (const [key, field] of Object.entries(fields)) if (!field.isOptional() && !(key in node.input) && node.map?.itemField !== key) throw new Error(`${node.id}.${key}: 缺少必需输入。`);
    for (const [key, binding] of Object.entries(node.input)) {
      if (!(key in fields)) throw new Error(`${node.id}.${key}: 未知输入端口。`);
      validateBinding(binding, node.id);
      if (binding.source === "literal") (fields as Record<string, z.ZodType>)[key].parse(binding.value);
      if (binding.source === "node" && !binding.path) {
        const source = nodes.get(binding.nodeId)!;
        const type = operationCatalog[source.operation.id].outputType;
        if (!["core.value", "core.end", "core.validate", "model.generate"].includes(source.operation.id) && !source.map) {
          const probe = type === "string" ? "x" : type === "boolean" ? true : type === "array" ? [] : {};
          const result = (fields as Record<string, z.ZodType>)[key].safeParse(probe);
          if (!result.success && result.error.issues.some((issue) => issue.code === "invalid_type" && !issue.path.length)) throw new Error(`${node.id}.${key}: 端口类型不匹配。`);
        }
      }
    }
    if (node.map) { validateBinding(node.map.items, node.id); if (!(node.map.itemField in fields)) throw new Error(`${node.id}: map 输入字段不存在。`); }
  }
  validateBinding(definition.output);
  const order: string[] = [];
  while (order.length < nodes.size) {
    const next = definition.nodes.filter((node) => !order.includes(node.id) && [...dependencies.get(node.id)!].every((dependency) => order.includes(dependency)));
    if (!next.length) throw new Error("workflow: 存在循环引用。");
    order.push(...next.map((node) => node.id));
  }
  const capabilities = [...new Set(definition.nodes.map((node) => operationCatalog[node.operation.id].capability).filter((value): value is NonNullable<typeof value> => value !== null))];
  return { definition, inputSchema, outputSchema, order, dependencies, capabilities };
}
export function resolveBinding(binding: WorkflowBinding, context: { input: JsonObject; settings: JsonObject; outputs: Record<string, JsonValue> }): JsonValue {
  if (binding.source === "literal") return binding.value;
  let value: JsonValue | undefined = binding.source === "input" ? context.input : binding.source === "settings" ? context.settings : context.outputs[binding.nodeId];
  for (const part of binding.path ? binding.path.split(".") : []) {
    if (value === null || typeof value !== "object" || ["__proto__", "constructor", "prototype"].includes(part)) throw new Error(`绑定无法解析：${binding.path}`);
    value = Array.isArray(value) ? value[Number(part)] : value[part];
  }
  if (value === undefined) throw new Error(`绑定值缺失：${binding.path}`);
  return value;
}
export function validateWorkflowInput(plan: ReturnType<typeof compileWorkflow>, input: JsonObject) { return validateSchemaValue(plan.inputSchema, input); }
