import { z } from "zod";

export type JsonValue = z.infer<ReturnType<typeof z.json>>;
export type JsonObject = { [key: string]: JsonValue };
const dangerousKeys = new Set(["__proto__", "prototype", "constructor"]);

export function boundedJson(value: unknown, maxBytes = 256 * 1024): JsonValue {
  const pending: Array<[unknown, number]> = [[value, 0]];
  let nodes = 0;
  while (pending.length) {
    const [entry, depth] = pending.pop()!;
    if (++nodes > 20000 || depth > 24) throw new Error("数据层级或条目过多。");
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") continue;
    if (typeof entry === "number" && Number.isFinite(entry)) continue;
    if (typeof entry !== "object" || !entry) throw new Error("只允许 JSON 数据。");
    for (const [key, child] of Object.entries(entry)) {
      if (dangerousKeys.has(key)) throw new Error("数据包含保留字段。");
      pending.push([child, depth + 1]);
    }
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > maxBytes) throw new Error("数据超过大小限制。");
  return value as JsonValue;
}

export type DataSchema = {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  title?: string; description?: string; default?: JsonValue; enum?: JsonValue[];
  properties?: Record<string, DataSchema>; required?: string[]; additionalProperties?: false;
  items?: DataSchema; minItems?: number; maxItems?: number;
  minLength?: number; maxLength?: number; minimum?: number; maximum?: number;
};
const keywords = new Set(["type", "title", "description", "default", "enum", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum"]);

/** A deliberately bounded, documented subset; unknown keywords fail closed. */
export function parseDataSchema(value: unknown): DataSchema {
  boundedJson(value, 64 * 1024);
  function visit(raw: unknown, depth: number): DataSchema {
    if (depth > 12 || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("数据 schema 无效。");
    const schema = raw as DataSchema;
    for (const key of Object.keys(schema)) if (!keywords.has(key)) throw new Error(`暂不支持 schema 关键字：${key}`);
    if (!["object", "array", "string", "number", "integer", "boolean", "null"].includes(schema.type)) throw new Error("schema 必须声明明确的 type。");
    if (schema.type === "object") {
      if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties) || schema.additionalProperties !== false) throw new Error("对象必须声明 properties 并关闭额外字段。");
      for (const child of Object.values(schema.properties)) visit(child, depth + 1);
      if (schema.required && (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== "string" || !Object.prototype.hasOwnProperty.call(schema.properties!, key)))) throw new Error("required 指向不存在的字段。");
    }
    if (schema.type === "array") visit(schema.items, depth + 1);
    for (const key of ["minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum"] as const) {
      if (schema[key] !== undefined && (typeof schema[key] !== "number" || !Number.isFinite(schema[key]))) throw new Error(`schema ${key} 无效。`);
    }
    if (schema.enum && (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.length > 100)) throw new Error("enum 无效。");
    return schema;
  }
  return visit(value, 0);
}

export function validateSchemaValue(schema: DataSchema, input: unknown, path = "数据"): JsonValue {
  const value = boundedJson(input);
  function check(s: DataSchema, v: JsonValue, at: string) {
    if (s.enum && !s.enum.some((item) => JSON.stringify(item) === JSON.stringify(v))) throw new Error(`${at} 不在可选范围内。`);
    if (s.type === "object") {
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${at} 必须是对象。`);
      for (const key of s.required ?? []) if (!Object.prototype.hasOwnProperty.call(v, key)) throw new Error(`${at}.${key} 不能为空。`);
      for (const [key, child] of Object.entries(v)) { if (!Object.prototype.hasOwnProperty.call(s.properties!, key)) throw new Error(`${at}.${key} 是未知字段。`); check(s.properties![key], child, `${at}.${key}`); }
    } else if (s.type === "array") {
      if (!Array.isArray(v) || v.length < (s.minItems ?? 0) || v.length > (s.maxItems ?? 1000)) throw new Error(`${at} 数组长度无效。`);
      v.forEach((item, i) => check(s.items!, item, `${at}[${i}]`));
    } else if (s.type === "string") {
      if (typeof v !== "string" || v.length < (s.minLength ?? 0) || v.length > (s.maxLength ?? 100000)) throw new Error(`${at} 文本长度无效。`);
    } else if (s.type === "number" || s.type === "integer") {
      if (typeof v !== "number" || !Number.isFinite(v) || (s.type === "integer" && !Number.isInteger(v)) || v < (s.minimum ?? -Infinity) || v > (s.maximum ?? Infinity)) throw new Error(`${at} 数值超出范围。`);
    } else if (s.type === "boolean" ? typeof v !== "boolean" : v !== null) throw new Error(`${at} 类型不符。`);
  }
  check(schema, value, path); return value;
}

export function schemaDefaults(schema: DataSchema): JsonValue {
  if (schema.default !== undefined) return structuredClone(schema.default);
  if (schema.enum) return structuredClone(schema.enum[0]);
  if (schema.type === "object") return Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([key, child]) => child.default !== undefined || schema.required?.includes(key)).map(([key, child]) => [key, schemaDefaults(child)]));
  return schema.type === "array" ? [] : schema.type === "string" ? "" : schema.type === "boolean" ? false : schema.type === "null" ? null : schema.minimum ?? 0;
}
