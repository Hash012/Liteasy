import { DeviceControlError } from "./service.mjs";

/** Authentication and body parsing remain owned by the host API. */
export async function handleDeviceControl({ request, url, service, authenticate, readBody, send }) {
  const match = /^\/v1\/(mobile|desktop)\/(devices(?:\/register|\/heartbeat|\/pair-code)?|pairs(?:\/[a-f0-9-]+)?|tasks(?:\/claim|\/[a-f0-9-]+\/(?:start|defer|progress|receipt|cancel))?)$/.exec(url.pathname);
  if (!match) return false;
  const kind = match[1]; const route = match[2]; const method = request.method;
  const identity = await authenticate(kind);
  const auth = { deviceId: request.headers["x-liteasy-device-id"], secret: request.headers["x-liteasy-device-secret"] };
  const body = method === "POST" ? await readBody(request) : {};
  let value;
  if (method === "POST" && route === "devices/register") value = await service.register(identity.subject, kind, body);
  else if (method === "POST" && route === "devices/heartbeat") value = await service.heartbeat(identity.subject, kind, auth, body);
  else if (method === "GET" && ["devices", "tasks"].includes(route)) value = await service.list(identity.subject, kind, auth);
  else if (method === "POST" && route === "devices/pair-code" && kind === "desktop") value = await service.pairCode(identity.subject, auth);
  else if (method === "POST" && route === "pairs" && kind === "mobile") value = await service.pair(identity.subject, auth, body);
  else if (method === "DELETE" && route.startsWith("pairs/")) value = await service.revokePair(identity.subject, kind, auth, route.split("/")[1]);
  else if (method === "POST" && route === "tasks" && kind === "mobile") value = await service.enqueue(identity.subject, auth, body);
  else if (method === "POST" && route === "tasks/claim" && kind === "desktop") value = await service.claim(identity.subject, auth);
  else if (method === "POST" && route.startsWith("tasks/") && kind === "desktop" && /\/(start|defer|progress|receipt)$/.test(route)) value = await service.updateTask(identity.subject, auth, route.split("/")[1], route.split("/")[2], body);
  else if (method === "POST" && /^tasks\/[^/]+\/cancel$/.test(route) && kind === "mobile") value = await service.cancel(identity.subject, auth, route.split("/")[1]);
  else throw new DeviceControlError("device_route_not_allowed", 405);
  send(value); return true;
}
