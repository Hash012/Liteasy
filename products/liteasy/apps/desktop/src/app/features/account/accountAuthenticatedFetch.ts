import {
  getAccountSessionGeneration,
  isCurrentAccountSessionToken,
  loadStoredAccountSession
} from "./accountSessionStorage";

type SessionRefresher = {
  refresh: (force?: boolean) => Promise<void>;
  invalidate: () => void;
};

let sessionRefresher: SessionRefresher | undefined;

export function registerAccountSessionRefresher(refresher: SessionRefresher) {
  sessionRefresher = refresher;
  return () => { if (sessionRefresher === refresher) sessionRefresher = undefined; };
}

/** First-party API requests share renewal, including the first request after sleep. */
export const accountAuthenticatedFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const token = headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const refresher = sessionRefresher;
  if (!token || !refresher) return fetch(input, init);
  const generation = getAccountSessionGeneration();
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  function assertCurrent() {
    signal?.throwIfAborted();
    if (refresher !== sessionRefresher || generation !== getAccountSessionGeneration() ||
      !isCurrentAccountSessionToken(token!)) throw new Error("account_session_changed");
  }
  async function send() {
    assertCurrent();
    const session = loadStoredAccountSession();
    if (!session) throw new Error("account_session_invalid");
    headers.set("Authorization", `Bearer ${session.sessionId}`);
    const response = await fetch(input, { ...init, headers });
    assertCurrent();
    return response;
  }
  assertCurrent();
  await refresher.refresh();
  let response = await send();
  if (response.status === 401) {
    await response.body?.cancel();
    await refresher.refresh(true);
    response = await send();
    if (response.status === 401) refresher.invalidate();
  }
  return response;
};
