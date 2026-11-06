import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { accountAuthenticatedFetch, registerAccountSessionRefresher } from "../app/features/account/accountAuthenticatedFetch";
import { clearStoredAccountSession, getAccountSessionGeneration, replaceRefreshedAccountSession, storeAccountSession } from "../app/features/account/accountSessionStorage";

const session = { email: "a@example.test", name: "A", userId: "a", issuer: "https://id.example.test", endpoint: "https://api.example.test", sessionId: "token-a", expiresAt: "2099-01-01T00:00:00Z" };
let unregister: (() => void) | undefined;
beforeEach(() => { clearStoredAccountSession(); storeAccountSession(session); });
afterEach(() => { unregister?.(); unregister = undefined; vi.unstubAllGlobals(); clearStoredAccountSession(); });

test("uses the renewed token for a request captured before renewal", async () => {
  const generation = getAccountSessionGeneration();
  const refresh = vi.fn(async () => { replaceRefreshedAccountSession({ ...session, sessionId: "renewed-a" }, generation); });
  unregister = registerAccountSessionRefresher({ refresh, invalidate: vi.fn() });
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("ok"));
  vi.stubGlobal("fetch", fetchImpl);
  await accountAuthenticatedFetch(`${session.endpoint}/v1/model/generate`, { headers: { Authorization: "Bearer token-a" } });
  expect(refresh).toHaveBeenCalledOnce();
  expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer renewed-a");
});

test("refreshes once on 401 and retries the exact publication body with the new token", async () => {
  const generation = getAccountSessionGeneration(), invalidate = vi.fn();
  const refresh = vi.fn(async (force?: boolean) => {
    if (force) replaceRefreshedAccountSession({ ...session, sessionId: "renewed-a" }, generation);
  });
  unregister = registerAccountSessionRefresher({ refresh, invalidate });
  const sent: { body: unknown; token: string | null }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    sent.push({ body: init.body, token: new Headers(init.headers).get("Authorization") });
    return new Response("{}", { status: sent.length === 1 ? 401 : 200 });
  }));
  const body = JSON.stringify({ operationId: "same-operation", annotations: [{ id: "local-a" }] });
  const response = await accountAuthenticatedFetch("https://forum.example.test/v1/annotations:apply", { method: "POST", body, headers: { Authorization: "Bearer token-a" } });
  expect(response.status).toBe(200);
  expect(sent).toEqual([{ body, token: "Bearer token-a" }, { body, token: "Bearer renewed-a" }]);
  expect(refresh.mock.calls).toEqual([[], [true]]);
  expect(invalidate).not.toHaveBeenCalled();
});

test("does not send an old account request after logout or account switching during renewal", async () => {
  const fetchImpl = vi.fn();
  vi.stubGlobal("fetch", fetchImpl);
  unregister = registerAccountSessionRefresher({ refresh: async () => {
    clearStoredAccountSession();
    storeAccountSession({ ...session, userId: "b", sessionId: "token-b" });
  }, invalidate: vi.fn() });
  await expect(accountAuthenticatedFetch(session.endpoint, { headers: { Authorization: "Bearer token-a" } })).rejects.toThrow("account_session_changed");
  expect(fetchImpl).not.toHaveBeenCalled();
});

test("an aborted request waiting for renewal is never dispatched", async () => {
  const controller = new AbortController(), fetchImpl = vi.fn();
  vi.stubGlobal("fetch", fetchImpl);
  unregister = registerAccountSessionRefresher({ refresh: async () => { controller.abort(); }, invalidate: vi.fn() });
  await expect(accountAuthenticatedFetch(session.endpoint, { signal: controller.signal, headers: { Authorization: "Bearer token-a" } })).rejects.toThrow();
  expect(fetchImpl).not.toHaveBeenCalled();
});

test.each([401, 403, 503])("handles a persistent %s without unbounded retry", async (status) => {
  const refresh = vi.fn(async () => {}), invalidate = vi.fn();
  unregister = registerAccountSessionRefresher({ refresh, invalidate });
  const fetchImpl = vi.fn(async () => new Response("{}", { status }));
  vi.stubGlobal("fetch", fetchImpl);
  expect((await accountAuthenticatedFetch(session.endpoint, { headers: { Authorization: "Bearer token-a" } })).status).toBe(status);
  expect(fetchImpl).toHaveBeenCalledTimes(status === 401 ? 2 : 1);
  expect(invalidate).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
});
