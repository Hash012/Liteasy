import type { AccountSession } from "./account.types";
import { getAccountSessionGeneration, loadStoredAccountSession } from "./accountSessionStorage";
import { CloudServiceError } from "../network/cloudErrorMessage";

function isSafeServiceUrl(value: string) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash &&
      (url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)));
  } catch {
    return false;
  }
}

export function accountActorStorageKey(session: AccountSession | null, endpoint: string) {
  const normalizedEndpoint = endpoint.replace(/\/+$/, "");
  if (!session?.userId?.trim() || !session.issuer || !session.endpoint ||
    session.endpoint.replace(/\/+$/, "") !== normalizedEndpoint ||
    !isSafeServiceUrl(normalizedEndpoint) || !isSafeServiceUrl(session.issuer)) return undefined;
  return [normalizedEndpoint, session.issuer, session.userId].map(encodeURIComponent).join("::");
}

export function captureAccountSessionRequest(endpoint: string) {
  const session = loadStoredAccountSession();
  const generation = getAccountSessionGeneration();
  const actorKey = accountActorStorageKey(session, endpoint);
  function assertCurrent() {
    if (!session?.sessionId) throw new Error("请先登录，再访问云端文献库。");
    if (generation !== getAccountSessionGeneration() ||
      (session.endpoint && session.endpoint.replace(/\/+$/, "") !== endpoint.replace(/\/+$/, ""))) {
      throw new CloudServiceError({ code: "account_session_changed", message: "账号或云服务已变化，请重新操作。", status: 409 });
    }
  }
  return { actorKey, assertCurrent, generation, sessionId: session?.sessionId };
}
