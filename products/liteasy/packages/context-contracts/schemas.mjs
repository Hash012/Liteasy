// Contract source. generate.mjs writes the versioned, LF-only shared schemas.
const base = "https://schemas.liteasy.app/";
const ref = (name) => ({ $ref: `${base}${name}.v1.schema.json` });
const string = (maxLength, minLength = 1) => ({ type: "string", minLength, maxLength });
const enumeration = (...values) => ({ type: "string", enum: values });
const object = (properties, required = Object.keys(properties)) => ({
  type: "object", properties, required, additionalProperties: false
});
const array = (items, maxItems = 20) => ({ type: "array", items, maxItems });
const constant = (value) => ({ const: value });
const uuid = { type: "string", format: "uuid" };
const date = { type: "string", format: "date-time" };
const revision = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const scope = { type: "string", pattern: "^(personal|project/[a-z0-9][a-z0-9-]{0,63})$" };
const scopes = { ...array(scope, 50), uniqueItems: true };
const scopeSelection = { ...array({ anyOf: [scope, constant("*")] }, 50), uniqueItems: true };
const kind = enumeration("profile", "understanding", "progress", "idea", "group_background", "reference");
const status = enumeration("active", "draft", "archived");
const source = object({
  provider: enumeration("liteasy", "zotero", "web", "user", "import", "other"),
  origin: string(512), sourceId: string(512), title: string(180, 0),
  revision: { anyOf: [string(128), { type: "null" }] },
  contentHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
  locator: string(4096, 0), capturedAt: date,
  availability: enumeration("remote", "local_only", "unknown", "unavailable"),
  nativeRef: { anyOf: [ref("resourceRef"), ref("objectRef"), ref("contextRef")] }
}, ["provider", "origin"]);
const entryProperties = {
  scopeKey: scope, kind, title: string(160), bodyMarkdown: string(12000),
  basis: enumeration("user_authored", "user_statement", "agent_summary", "source_excerpt", "imported"),
  status: { ...status, default: "active" },
  tags: { ...array(string(64)), uniqueItems: true }, sourceRefs: array(source),
  attributes: { type: "object", maxProperties: 20 }
};
const input = object(entryProperties, ["scopeKey", "kind", "title", "bodyMarkdown", "basis"]);
const stored = object({
  schemaVersion: constant("liteasy.context-entry/v1"),
  id: uuid, revision, owner: string(300), actor: string(400),
  ...entryProperties, createdAt: date, updatedAt: date
});
export const contextEntrySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${base}contextEntry.v1.schema.json`, ...input,
  $defs: { stored, sourceRef: source, scopeKey: scope, kind }
};
const writeProperties = {
  schemaVersion: constant("liteasy.context-write/v1"), operationId: uuid
};
export const contextWriteSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${base}contextWrite.v1.schema.json`,
  oneOf: [
    object({ ...writeProperties, action: constant("create"), entry: ref("contextEntry") }),
    object({ ...writeProperties, action: constant("update"), entryId: uuid, expectedRevision: revision, entry: ref("contextEntry") }),
    object({ ...writeProperties, action: constant("delete"), entryId: uuid, expectedRevision: revision })
  ]
};
const apiVersion = constant("liteasy.context-api/v1");
const storedRef = { $ref: `${base}contextEntry.v1.schema.json#/$defs/stored` };
const receipt = object({
  schemaVersion: apiVersion, operationId: uuid, entryId: uuid, revision,
  action: enumeration("create", "update", "delete"), scopeKey: scope,
  committedAt: date, expiresAt: date
});
const filterProperties = {
  scopes, kinds: { ...array(kind, 6), uniqueItems: true },
  tags: { ...array(string(64)), uniqueItems: true }, query: string(256, 0), status,
  limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: string(512)
};
const filters = object(filterProperties, []);
const queryRequest = object({
  schemaVersion: apiVersion, ...filterProperties,
  maxChars: { type: "integer", minimum: 1, maximum: 100000 }
}, ["schemaVersion", "maxChars"]);
const grantInput = object({
  name: string(80), readScopes: scopeSelection, writeScopes: scopeSelection, expiresAt: date
});
const grant = object({
  id: uuid, name: string(80), readScopes: scopeSelection, writeScopes: scopeSelection,
  expiresAt: date, createdAt: date,
  revokedAt: { anyOf: [date, { type: "null" }] },
  lastUsedAt: { anyOf: [date, { type: "null" }] }
});
const error = object({
  schemaVersion: apiVersion,
  error: object({
    code: string(100), message: string(500), retryable: { type: "boolean" }, requestId: uuid,
    currentRevision: revision
  }, ["code", "message", "retryable", "requestId"])
});
export const contextApiSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${base}contextApi.v1.schema.json`,
  $defs: {
    write: ref("contextWrite"), filters, queryRequest, receipt, grantInput, grant, error,
    entryResponse: object({ schemaVersion: apiVersion, entry: storedRef }),
    listResponse: object({
      schemaVersion: apiVersion, entries: array(storedRef, 100),
      nextCursor: { anyOf: [string(512), { type: "null" }] }
    }),
    historyResponse: object({
      schemaVersion: apiVersion, revisions: array(storedRef, 100),
      nextCursor: { anyOf: [string(512), { type: "null" }] }
    }),
    queryResponse: object({
      schemaVersion: apiVersion, generatedAt: date, selectedEntries: array(storedRef, 100),
      filters,
      budget: object({ maxChars: { type: "integer", minimum: 1 }, usedChars: { type: "integer", minimum: 0 }, unit: constant("unicode_code_point") }),
      omitted: array(object({
        id: uuid, revision, title: string(160), scopeKey: scope, kind,
        length: { type: "integer", minimum: 1 }, reason: constant("budget")
      }), 100),
      nextCursor: { anyOf: [string(512), { type: "null" }] }
    }),
    whoamiResponse: object({
      schemaVersion: apiVersion, subject: string(300), actor: string(400),
      readScopes: scopeSelection, writeScopes: scopeSelection,
      expiresAt: { anyOf: [date, { type: "null" }] },
      idempotencyWindowSeconds: { type: "integer", minimum: 1 }
    }),
    grantsResponse: object({ schemaVersion: apiVersion, grants: array(grant, 100) }),
    grantCreatedResponse: object({ schemaVersion: apiVersion, grant, secret: string(200) }),
    grantRevokedResponse: object({ schemaVersion: apiVersion, revoked: constant(true) })
  },
  anyOf: ["write", "queryRequest", "receipt", "entryResponse", "listResponse", "historyResponse", "queryResponse", "whoamiResponse", "error", "grantsResponse", "grantCreatedResponse", "grantRevokedResponse"]
    .map((name) => ({ $ref: `#/$defs/${name}` }))
};

export const contextSchemas = {
  contextEntry: contextEntrySchema, contextWrite: contextWriteSchema, contextApi: contextApiSchema
};
