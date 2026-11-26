import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { contextSchemas } from "../../../../packages/context-contracts/schemas.mjs";
import { ContextError } from "./contextError.mjs";

const ajv = new Ajv2020({ strict: true });
ajv.addFormat("uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
ajv.addFormat("date-time", (value) => /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)));
for (const name of ["resourceRef", "objectRef", "contextRef"]) {
  ajv.addSchema(JSON.parse(readFileSync(new URL(`../../../../packages/shared/${name}.v1.schema.json`, import.meta.url), "utf8")));
}
for (const schema of Object.values(contextSchemas)) ajv.addSchema(schema);
const validators = new Map();
export function validateContext(name, value) {
  if (!validators.has(name)) {
    validators.set(name, ajv.compile({ $ref: `${contextSchemas.contextApi.$id}#/$defs/${name}` }));
  }
  if (!validators.get(name)(value)) {
    throw new ContextError(value?.schemaVersion && !["liteasy.context-write/v1", "liteasy.context-api/v1"].includes(value.schemaVersion)
      ? "context_schema_unsupported" : "context_input_invalid");
  }
  if (name === "write" && value.entry) {
    if (!value.entry.title.trim() || !value.entry.bodyMarkdown.trim()) throw new ContextError("context_input_invalid");
    if (Buffer.byteLength(JSON.stringify(value.entry.attributes ?? {})) > 8192) throw new ContextError("context_attributes_too_large", 413);
  }
  return value;
}
export function validateUuid(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ContextError("context_id_invalid");
  }
  return value.toLowerCase();
}
