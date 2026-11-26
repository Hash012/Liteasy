export const contextApiVersion = "liteasy.context-api/v1";
export class ContextClientError extends Error {
  constructor(code, { status = 0, retryable = false, requestId, currentRevision } = {}) {
    super(code);
    Object.assign(this, { code, status, retryable, requestId, currentRevision });
  }
}

export function normalizeContextOrigin(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error();
    return url.origin;
  } catch { throw new ContextClientError("context_origin_invalid", { status: 400 }); }
}
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const listOfStrings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
const integer = (value) => Number.isSafeInteger(value) && value > 0;
function expect(condition) { if (!condition) throw new ContextClientError("context_protocol_invalid", { status: 502 }); }
function validEntry(value) {
  return object(value) && value.schemaVersion === "liteasy.context-entry/v1" && typeof value.id === "string" &&
    integer(value.revision) && typeof value.title === "string" && typeof value.bodyMarkdown === "string" &&
    typeof value.scopeKey === "string" && typeof value.owner === "string" && Array.isArray(value.sourceRefs);
}
function validReceipt(value) {
  return typeof value.entryId === "string" && typeof value.operationId === "string" && integer(value.revision) &&
    ["create", "update", "delete"].includes(value.action) && Number.isFinite(Date.parse(value.committedAt)) && Number.isFinite(Date.parse(value.expiresAt));
}
function validGrant(value) {
  return object(value) && typeof value.id === "string" && typeof value.name === "string" &&
    listOfStrings(value.readScopes) && listOfStrings(value.writeScopes) && Number.isFinite(Date.parse(value.expiresAt));
}
export async function fetchContextTransport(request) {
  return fetch(request.url, { method: request.method, headers: request.headers, body: request.body,
    signal: request.signal, redirect: "error", credentials: "omit" });
}

export class ContextClient {
  constructor({ origin, token, transport = fetchContextTransport, timeoutMs = 15000 }) {
    this.origin = normalizeContextOrigin(origin);
    this.token = token;
    this.transport = transport;
    this.timeoutMs = timeoutMs;
  }
  async request(method, path, body) {
    if (!path.startsWith("/v1/context/") || path.includes("#")) throw new ContextClientError("context_path_invalid", { status: 400 });
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin || !url.pathname.startsWith("/v1/context/")) throw new ContextClientError("context_path_invalid", { status: 400 });
    const token = typeof this.token === "function" ? await this.token() : this.token;
    if (typeof token !== "string" || !token || /\s/u.test(token)) throw new ContextClientError("context_authentication_required", { status: 401 });
    let response;
    let payload;
    try {
      response = await this.transport({ url: url.href, method,
        headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(this.timeoutMs) });
      payload = await response.json();
    } catch {
      throw new ContextClientError(response ? "context_protocol_invalid" : "context_network_unavailable", { status: response?.status ?? 0, retryable: !response });
    }
    if (response.status < 200 || response.status >= 300) {
      const error = object(payload?.error) ? payload.error : {};
      throw new ContextClientError(typeof error.code === "string" ? error.code : "context_request_failed", {
        status: response.status, retryable: error.retryable === true || response.status >= 500,
        requestId: typeof error.requestId === "string" ? error.requestId : undefined,
        currentRevision: integer(error.currentRevision) ? error.currentRevision : undefined
      });
    }
    expect(object(payload) && payload.schemaVersion === contextApiVersion);
    return payload;
  }
  async whoami() {
    const value = await this.request("GET", "/v1/context/whoami");
    expect(typeof value.subject === "string" && typeof value.actor === "string" && listOfStrings(value.readScopes) &&
      listOfStrings(value.writeScopes) && integer(value.idempotencyWindowSeconds));
    return value;
  }
  async write(input) {
    const path = input.action === "create" ? "/v1/context/entries" :
      `/v1/context/entries/${encodeURIComponent(input.entryId)}/${input.action === "delete" ? "delete" : "revisions"}`;
    const value = await this.request("POST", path, input);
    expect(validReceipt(value) && value.operationId === input.operationId && value.action === input.action &&
      (input.action === "create" || value.entryId === input.entryId));
    return value;
  }
  async get(id) {
    const value = await this.request("GET", `/v1/context/entries/${encodeURIComponent(id)}`);
    expect(validEntry(value.entry) && value.entry.id === id);
    return value;
  }
  async operation(id) {
    const value = await this.request("GET", `/v1/context/operations/${encodeURIComponent(id)}`);
    expect(validReceipt(value) && value.operationId === id);
    return value;
  }
  async list(filters = {}) {
    const value = await this.request("GET", `/v1/context/entries${encodeFilters(filters)}`);
    expect(Array.isArray(value.entries) && value.entries.length <= 100 && value.entries.every(validEntry) && (value.nextCursor === null || typeof value.nextCursor === "string"));
    return value;
  }
  async history(id, filters = {}) {
    const value = await this.request("GET", `/v1/context/entries/${encodeURIComponent(id)}/revisions${encodeFilters(filters)}`);
    expect(Array.isArray(value.revisions) && value.revisions.length <= 100 && value.revisions.every(validEntry) && (value.nextCursor === null || typeof value.nextCursor === "string"));
    return value;
  }
  async query(input) {
    const value = await this.request("POST", "/v1/context/query", input);
    expect(object(value.filters) && Array.isArray(value.selectedEntries) && value.selectedEntries.length <= 100 && value.selectedEntries.every(validEntry) &&
      Array.isArray(value.omitted) && object(value.budget) && value.budget.maxChars === input.maxChars &&
      value.budget.unit === "unicode_code_point" && Number.isSafeInteger(value.budget.usedChars) && value.budget.usedChars >= 0 && value.budget.usedChars <= input.maxChars);
    expect(value.selectedEntries.reduce((sum, entry) => sum + Array.from(entry.title).length + Array.from(entry.bodyMarkdown).length, 0) === value.budget.usedChars);
    return value;
  }
  async grants() {
    const value = await this.request("GET", "/v1/context/grants");
    expect(Array.isArray(value.grants) && value.grants.length <= 100 && value.grants.every(validGrant)); return value;
  }
  async createGrant(input) {
    const value = await this.request("POST", "/v1/context/grants", input);
    expect(validGrant(value.grant) && typeof value.secret === "string" && /^lcg_[A-Za-z0-9_-]{43}$/.test(value.secret)); return value;
  }
  async revokeGrant(id) {
    const value = await this.request("DELETE", `/v1/context/grants/${encodeURIComponent(id)}`);
    expect(value.revoked === true); return value;
  }
}
function encodeFilters(filters) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) continue;
    if (["scopes", "kinds", "tags"].includes(key)) for (const item of value) search.append({ scopes: "scope", kinds: "kind", tags: "tag" }[key], item);
    else search.set(key, String(value));
  }
  return search.size ? `?${search}` : "";
}
