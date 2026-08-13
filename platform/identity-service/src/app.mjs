import { authorizeManagementRequest } from "./authorization.mjs";
import { IdentityManagementError } from "./keycloakClient.mjs";

const statuses = new Set(["active", "disabled", "deleted"]);

function send(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
    "content-type": "application/json; charset=utf-8"
  });
  response.end(payload);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) throw new IdentityManagementError("request_too_large", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new IdentityManagementError("request_body_invalid", 400);
  }
}

function requiredHeader(request, name, pattern, code) {
  const value = request.headers[name];
  if (typeof value !== "string" || !pattern.test(value)) throw new IdentityManagementError(code, 400);
  return value;
}

function accountDirectoryQuery(url) {
  const allowed = new Set(["first", "max", "search"]);
  if ([...url.searchParams.keys()].some((key) => (
    !allowed.has(key) || url.searchParams.getAll(key).length !== 1
  ))) {
    throw new IdentityManagementError("account_directory_query_invalid", 400);
  }
  const firstValue = url.searchParams.get("first") ?? "0";
  const maxValue = url.searchParams.get("max") ?? "50";
  if (!/^\d+$/.test(firstValue) || !/^\d+$/.test(maxValue)) {
    throw new IdentityManagementError("account_directory_query_invalid", 400);
  }
  const first = Number(firstValue);
  const max = Number(maxValue);
  const search = (url.searchParams.get("search") ?? "").trim();
  if (!Number.isSafeInteger(first) || first < 0 || first > 1_000_000 || max < 1 || max > 100 || search.length > 100) {
    throw new IdentityManagementError("account_directory_query_invalid", 400);
  }
  return { first, max, search };
}

export function createIdentityManagementHandler(config, keycloak, dependencies = {}) {
  const authorize = dependencies.authorize ?? authorizeManagementRequest;
  return async function handler(request, response) {
    try {
      const url = new URL(request.url ?? "/", "http://identity-management.local");
      if (request.method === "GET" && url.pathname === "/healthz") {
        send(response, 200, { status: "ok" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/readyz") {
        await keycloak.verifyReadiness();
        send(response, 200, { dependencies: { keycloakAdminApi: true }, status: "ready" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/accounts") {
        await authorize(request.headers.authorization, config.authorization, dependencies.fetchImpl);
        send(response, 200, await keycloak.listAccounts(accountDirectoryQuery(url)));
        return;
      }
      const match = /^\/v1\/accounts\/([^/]+)\/status$/.exec(url.pathname);
      if (request.method !== "POST" || !match) {
        send(response, 404, { code: "route_not_found" });
        return;
      }
      await authorize(request.headers.authorization, config.authorization, dependencies.fetchImpl);
      const subjectId = decodeURIComponent(match[1]);
      if (!/^[A-Za-z0-9._:-]{1,300}$/.test(subjectId)) {
        throw new IdentityManagementError("identity_subject_invalid", 400);
      }
      requiredHeader(request, "x-idempotency-key", /^[A-Za-z0-9._:-]{8,200}$/, "idempotency_key_invalid");
      requiredHeader(request, "x-trace-id", /^[A-Za-z0-9._:-]{1,300}$/, "trace_id_invalid");
      const body = await readJson(request);
      if (!statuses.has(body.status)) throw new IdentityManagementError("account_status_invalid", 400);
      if (typeof body.reason !== "string" || body.reason.trim().length < 8 || body.reason.trim().length > 1000) {
        throw new IdentityManagementError("account_reason_invalid", 400);
      }
      send(response, 200, await keycloak.setStatus(subjectId, body.status));
    } catch (error) {
      const known = error instanceof IdentityManagementError;
      send(response, known ? error.status : 500, {
        code: known ? error.code : "identity_management_internal_error"
      });
    }
  };
}
