import { randomUUID } from "node:crypto";
import { ContextError, contextErrorBody } from "./contextError.mjs";

function parameters(url, history = false) {
  const allowed = history ? ["limit", "cursor"] : ["scope", "kind", "tag", "query", "status", "limit", "cursor"];
  if ([...url.searchParams.keys()].some((key) => !allowed.includes(key))) throw new ContextError("context_input_invalid");
  const result = {};
  for (const [key, name] of [["scope", "scopes"], ["kind", "kinds"], ["tag", "tags"]]) {
    if (url.searchParams.has(key)) result[name] = url.searchParams.getAll(key);
  }
  for (const key of ["query", "status", "cursor", "limit"]) {
    if (!url.searchParams.has(key)) continue;
    if (url.searchParams.getAll(key).length !== 1) throw new ContextError("context_input_invalid");
    result[key] = key === "limit" ? Number(url.searchParams.get(key)) : url.searchParams.get(key);
  }
  return result;
}

export async function handleContextRequest({ request, response, url, runtime, config, readJsonBody, sendJson }) {
  if (url.pathname !== "/v1/context" && !url.pathname.startsWith("/v1/context/")) return false;
  try {
    if (!runtime.contextEntryService || !runtime.contextGrantRepository) throw new ContextError("context_service_unavailable", 503);
    const header = request.headers.authorization;
    const usingGrant = typeof header === "string" && /^Bearer lcg_/i.test(header);
    const managing = url.pathname === "/v1/context/grants" || url.pathname.startsWith("/v1/context/grants/");
    if (usingGrant && managing) throw new ContextError("context_grant_management_forbidden", 403);
    const identity = usingGrant ? await runtime.contextGrantRepository.authenticate(header) : {
      ...await runtime.identityVerifier.verifyAuthorizationHeader(header, "liteasy-desktop", config.identity.desktopClientId),
      actor: "desktop"
    };
    const service = runtime.contextEntryService;
    const path = url.pathname.slice("/v1/context".length);
    const match = /^\/entries\/([^/]+)(?:\/(revisions|delete))?$/.exec(path);
    let value;
    let status = 200;
    if (path === "/whoami" && request.method === "GET") value = await service.whoami(identity);
    else if (path === "/query" && request.method === "POST") value = await service.query(identity, await readJsonBody(request, 16384));
    else if (path === "/entries" && request.method === "GET") value = await service.list(identity, parameters(url));
    else if (path === "/entries" && request.method === "POST") {
      const body = await readJsonBody(request, 128 * 1024);
      if (body.action !== "create") throw new ContextError("context_action_invalid");
      value = await service.write(identity, body); status = 201;
    } else if (match && request.method === "GET" && !match[2]) value = await service.get(identity, match[1]);
    else if (match && request.method === "GET" && match[2] === "revisions") value = await service.history(identity, match[1], parameters(url, true));
    else if (match && request.method === "POST" && ["revisions", "delete"].includes(match[2])) {
      const body = await readJsonBody(request, 128 * 1024);
      if (body.entryId !== match[1] || body.action !== (match[2] === "delete" ? "delete" : "update")) throw new ContextError("context_action_invalid");
      value = await service.write(identity, body);
    } else if (/^\/operations\/[^/]+$/.test(path) && request.method === "GET") value = await service.operation(identity, path.split("/")[2]);
    else if (path === "/grants" && request.method === "GET") value = await runtime.contextGrantRepository.list(identity);
    else if (path === "/grants" && request.method === "POST") { value = await runtime.contextGrantRepository.create(identity, await readJsonBody(request, 16384)); status = 201; }
    else if (/^\/grants\/[^/]+$/.test(path) && request.method === "DELETE") value = await runtime.contextGrantRepository.revoke(identity, path.split("/")[2]);
    else throw new ContextError("context_route_not_found", 404);
    sendJson(response, status, value);
  } catch (error) {
    const result = contextErrorBody(error, randomUUID());
    sendJson(response, result.status, result.body);
  }
  return true;
}
