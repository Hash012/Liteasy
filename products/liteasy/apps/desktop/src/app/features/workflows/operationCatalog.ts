import { z } from "zod";
import { parseDataSchema, type DataSchema } from "../extensions/extensionSchema";
const path = z.string().min(1).max(8192), text = z.string().max(80000);
const operation = <T extends z.ZodType>(input: T, capability: string | null, effect: "pure" | "read" | "write" | "model" | "ui", retry: "safe" | "idempotent" | "never", outputType: DataSchema["type"] = "object") => ({ input, capability, effect, retry, version: "1.0.0", outputType });
/** Shared, executable catalog. No evaluator or arbitrary expression language. */
export const operationCatalog = {
  "core.value": operation(z.strictObject({ value: z.json() }), null, "pure", "safe"),
  "core.template": operation(z.strictObject({ template: text, values: z.record(z.string(), z.json()) }), null, "pure", "safe", "string"),
  "core.branch": operation(z.strictObject({ value: z.json(), equals: z.json() }), null, "pure", "safe", "boolean"),
  "core.validate": operation(z.strictObject({ value: z.json(), schema: z.json() }), null, "pure", "safe"),
  "core.wait": operation(z.strictObject({ message: z.string().max(2000) }), null, "pure", "never"),
  "core.join": operation(z.strictObject({ values: z.record(z.string(), z.json()).default({}) }), null, "pure", "safe"),
  "core.end": operation(z.strictObject({ value: z.json() }), null, "pure", "safe"),
  "resources.search": operation(z.strictObject({ query: z.string().max(2048).default(""), limit: z.number().int().min(1).max(200).default(50) }), "resources.metadata.read", "read", "safe", "array"),
  "resources.stat": operation(z.strictObject({ path }), "resources.metadata.read", "read", "safe"),
  "resources.read": operation(z.strictObject({ path, offset: z.number().int().nonnegative().default(0), maxCharacters: z.number().int().min(1).max(80000).default(12000) }), "resources.content.read", "read", "safe"),
  "resources.create": operation(z.strictObject({ kind: z.enum(["note", "board"]), title: z.string().min(1).max(240), text: text.optional(), paperPath: path.optional() }), "resources.create", "write", "idempotent"),
  "resources.write": operation(z.strictObject({ path, text, expectedRevision: z.string().min(1).max(512), mode: z.enum(["append", "replace"]) }), "resources.write", "write", "never"),
  "model.generate": operation(z.strictObject({ prompt: text, schema: z.json().optional(), maxOutputTokens: z.number().int().min(128).max(16000).default(4096) }), "model.invoke", "model", "never"),
  "ui.open": operation(z.strictObject({ path }), null, "ui", "safe"),
} as const;
export type OperationId = keyof typeof operationCatalog;
export const operationIds = Object.keys(operationCatalog) as OperationId[];
export function operationInputSchema(id: OperationId): DataSchema {
  const raw = z.toJSONSchema(operationCatalog[id].input) as Record<string, unknown>;
  // z.json emits recursive refs; bindings are validated at execution using the full Zod schema.
  const simplify = (value: unknown): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const source = value as Record<string, unknown>;
    if ("$ref" in source || "anyOf" in source) return { type: "object", properties: {}, additionalProperties: false };
    return Object.fromEntries(Object.entries(source).filter(([key]) => !["$schema", "$defs"].includes(key)).map(([key, item]) => [key, key === "properties" ? Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([name, child]) => [name, simplify(child)])) : key === "items" ? simplify(item) : item]));
  };
  return parseDataSchema(simplify(raw));
}
