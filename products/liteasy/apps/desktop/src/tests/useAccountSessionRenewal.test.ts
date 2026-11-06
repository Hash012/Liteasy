import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useAccountSession } from "../app/features/account/useAccountSession";
import { clearStoredAccountSession, getAccountSessionGeneration, loadStoredAccountSession, storeAccountSession } from "../app/features/account/accountSessionStorage";
import { createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";
import { createBearerModelTransport } from "../app/features/models/modelHttpClient";
import { createForumClient } from "../app/features/forum/forumClient";
import type { DesktopIdentityInvoke } from "../app/features/account/desktopIdentityClient";

const endpoint = "https://api.example.test";
const config = { audience: "liteasy-desktop", authorizationFlow: "authorization_code_pkce", clientId: "liteasy-desktop", issuer: "https://id.example.test", revocationUrl: "https://id.example.test/revoke" };
const session = (token = "token-a") => ({ email: "a@example.test", name: "A", userId: "a", issuer: config.issuer,
  endpoint, sessionId: token, expiresAt: new Date(Date.now() + 300_000).toISOString() });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T00:00:00Z"));
  clearStoredAccountSession();
  storeAccountSession(session());
});
afterEach(() => { cleanup(); clearStoredAccountSession(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function setup(invoke = vi.fn(async (_command: string, _args?: Record<string, unknown>): Promise<unknown> => session("renewed-a"))) {
  const settings = createSeededSettingsStore({ "models.control_plane_endpoint": endpoint });
  return { invoke, ...renderHook(() => useAccountSession({ getSettings: () => settings.getState(),
    desktopIdentityHostAvailable: true, desktopIdentityInvoke: invoke as DesktopIdentityInvoke,
    desktopIdentityFetch: async () => new Response(JSON.stringify(config)) })) };
}

test("renews a five-minute login before expiry and continues renewing without changing the actor", async () => {
  const generation = getAccountSessionGeneration(), context = setup();
  await act(async () => { await vi.advanceTimersByTimeAsync(240_000); });
  expect(context.invoke).toHaveBeenCalledWith("restore_desktop_oauth_session", { configuration: config, refresh: true });
  expect(context.result.current.accountSession?.sessionId).toBe("renewed-a");
  expect(getAccountSessionGeneration()).toBe(generation);
  await act(async () => { await vi.advanceTimersByTimeAsync(240_000); });
  expect(context.invoke).toHaveBeenCalledTimes(2);
  expect(Date.parse(context.result.current.accountSession!.expiresAt)).toBeGreaterThan(Date.now());
});

test("model and forum requests after sleep wait for one shared renewal and send its token", async () => {
  let finish!: (value: unknown) => void;
  const invoke = vi.fn(async () => new Promise((resolve) => { finish = resolve; })), context = setup(invoke);
  const transport = createBearerModelTransport({ getAccessToken: () => loadStoredAccountSession()?.sessionId });
  const forum = createForumClient({ apiBaseUrl: "https://forum.example.test", getSessionId: () => loadStoredAccountSession()?.sessionId });
  const sent: { url: string; token: string | null }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    sent.push({ url: String(url), token: new Headers(init.headers).get("Authorization") });
    return new Response(JSON.stringify({ answer: "ok", handoffId: "handoff-a" }));
  }));
  vi.setSystemTime(new Date(Date.now() + 600_000));
  let modelRequest!: ReturnType<typeof transport>, forumRequest!: ReturnType<typeof forum.createDraftHandoff>;
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    modelRequest = transport({ url: `${endpoint}/v1/model/generate`, body: "{}", headers: {}, method: "POST" });
    forumRequest = forum.createDraftHandoff({ visibility: "private", targets: [{ kind: "source_passage",
      anchorHash: "sha256:source", excerpt: "local excerpt", literature: { literatureId: "literature-a" }, rects: [] }] });
    await Promise.resolve();
  });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(sent).toEqual([]);
  await act(async () => { finish(session("renewed-a")); await Promise.all([modelRequest, forumRequest]); });
  expect(sent).toHaveLength(2);
  expect(sent.map((request) => request.token)).toEqual(["Bearer renewed-a", "Bearer renewed-a"]);
  expect(context.result.current.accountSession?.sessionId).toBe("renewed-a");
});

test("an expired login stops appearing authenticated during a network failure and recovers on reconnect", async () => {
  let unavailable = true;
  const context = setup(vi.fn(async () => {
    if (unavailable) throw new Error("oauth_discovery_failed");
    return session("renewed-a");
  }));
  localStorage.setItem("local-reading-data", "keep me");
  vi.setSystemTime(new Date(Date.now() + 600_000));
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(context.result.current.accountSession).toBeNull();
  expect(context.result.current.accountMessage).toContain("连接恢复后会自动重试");
  expect(loadStoredAccountSession()?.userId).toBe("a");
  unavailable = false;
  await act(async () => { window.dispatchEvent(new Event("online")); });
  expect(context.result.current.accountSession?.sessionId).toBe("renewed-a");
  expect(localStorage.getItem("local-reading-data")).toBe("keep me");
});

test("an explicitly expired refresh credential clears the login and requests reauthentication", async () => {
  const context = setup(vi.fn(async () => { throw new Error("oauth_session_expired"); }));
  await act(async () => { await vi.advanceTimersByTimeAsync(240_000); });
  expect(context.result.current.accountSession).toBeNull();
  expect(loadStoredAccountSession()).toBeNull();
  expect(context.result.current.accountMessage).toContain("重新登录");
});

test("a renewal completing after logout cannot resurrect the account", async () => {
  let finish!: (value: unknown) => void;
  const invoke = vi.fn(async (command: string) => command === "restore_desktop_oauth_session"
    ? new Promise((resolve) => { finish = resolve; }) : { localCleared: true, remoteRevocation: "revoked" });
  const context = setup(invoke);
  vi.setSystemTime(new Date(Date.now() + 600_000));
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  act(() => { context.result.current.logoutFromCloudAccount(); });
  await act(async () => { finish(session("late-a")); });
  expect(context.result.current.accountSession).toBeNull();
  expect(loadStoredAccountSession()).toBeNull();
});
