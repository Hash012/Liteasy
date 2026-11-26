import { randomUUID } from "node:crypto";
import { ContextError, contextErrorBody } from "./contextError.mjs";

export async function handleMobileContextRequest({ request, response, url, runtime, config, readJsonBody, sendJson }) {
  if (url.pathname !== "/v1/mobile/context" && !url.pathname.startsWith("/v1/mobile/context/")) return false;
  try {
    if (!config.identity.mobileClientId || !runtime.contextEntryService) throw new ContextError("context_service_unavailable", 503);
    const identity = { ...await runtime.identityVerifier.verifyAuthorizationHeader(request.headers.authorization, "liteasy-mobile", config.identity.mobileClientId), actor: "mobile" };
    let value;
    if (url.pathname === "/v1/mobile/context/whoami" && request.method === "GET") value = await runtime.contextEntryService.whoami(identity);
    else if (url.pathname === "/v1/mobile/context/submit" && request.method === "POST") {
      const body = await readJsonBody(request, 128 * 1024);
      if (body.action !== "create" || body.entry?.kind !== "idea" || body.entry?.basis !== "user_authored") throw new ContextError("context_mobile_action_forbidden", 403);
      value = await runtime.contextEntryService.write(identity, body);
    } else if (/^\/v1\/mobile\/context\/operations\/[^/]+$/.test(url.pathname) && request.method === "GET") value = await runtime.contextEntryService.operation(identity, url.pathname.split("/").at(-1));
    else throw new ContextError("context_route_not_found", 404);
    sendJson(response, 200, value);
  } catch (error) {
    const result = contextErrorBody(error, randomUUID());
    sendJson(response, result.status, result.body);
  }
  return true;
}
