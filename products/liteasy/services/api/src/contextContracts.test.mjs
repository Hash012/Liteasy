import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { contextSchemas } from "../../../packages/context-contracts/schemas.mjs";

const ajv = new Ajv2020({ strict: true });
ajv.addFormat("uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
ajv.addFormat("date-time", (value) => /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)));
for (const name of ["resourceRef", "objectRef", "contextRef"]) {
  ajv.addSchema(JSON.parse(readFileSync(new URL(`../../../packages/shared/${name}.v1.schema.json`, import.meta.url), "utf8")));
}
for (const schema of Object.values(contextSchemas)) ajv.addSchema(schema);
const validate = ajv.getSchema(contextSchemas.contextWrite.$id);
const exampleRoot = new URL("../../../packages/context-contracts/examples/", import.meta.url);
const examples = readdirSync(exampleRoot).filter((name) => name.endsWith(".json"))
  .map((name) => JSON.parse(readFileSync(new URL(name, exampleRoot), "utf8")));

test("all six kinds and update/delete examples share the write contract", () => {
  for (const example of examples) assert.equal(validate(example), true, JSON.stringify(validate.errors));
  assert.equal(new Set(examples.filter((value) => value.action === "create").map((value) => value.entry.kind)).size, 6);
});

test("rejects forged identity, scope migration fields, unknown versions and missing CAS", () => {
  const create = examples[0];
  for (const invalid of [
    { ...create, owner: "another-account" },
    { ...create, schemaVersion: "liteasy.context-write/v2" },
    { ...create, entry: { ...create.entry, owner: "another-account" } },
    { ...create, entry: { ...create.entry, scopeKey: "team/secret" } },
    { ...create, action: "update", entryId: create.operationId },
    { ...create, entry: { ...create.entry, title: "a".repeat(161) } }
  ]) assert.equal(validate(invalid), false);
});

test("counts Unicode characters and validates native references using existing contracts", () => {
  const create = examples[0];
  const valid = { ...create, entry: { ...create.entry, title: "🧪".repeat(160), sourceRefs: [{
    provider: "liteasy", origin: "account", nativeRef: { providerId: "local", resourceId: "note", scopeId: "user:alice", revision: "r1" }
  }] } };
  assert.equal(validate(valid), true, JSON.stringify(validate.errors));
  valid.entry.sourceRefs[0].nativeRef = { resourceId: "bare-id-without-account-scope" };
  assert.equal(validate(valid), false);
});

test("conflicts carry current revision without a copy of private body or credentials", () => {
  const error = ajv.compile({ $ref: `${contextSchemas.contextApi.$id}#/$defs/error` });
  const value = { schemaVersion: "liteasy.context-api/v1", error: {
    code: "context_revision_conflict", message: "条目已更新", retryable: false,
    requestId: "11111111-1111-4111-8111-000000000001", currentRevision: 2
  } };
  assert.equal(error(value), true);
  assert.equal(error({ ...value, bodyMarkdown: "private" }), false);
});

test("generated shared schemas match their source exactly and use LF", () => {
  for (const [name, schema] of Object.entries(contextSchemas)) {
    const bytes = readFileSync(new URL(`../../../packages/shared/${name}.v1.schema.json`, import.meta.url), "utf8");
    assert.equal(bytes, `${JSON.stringify(schema, null, 2)}\n`);
    assert.equal(bytes.includes("\r"), false);
  }
});
