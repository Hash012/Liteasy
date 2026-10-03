import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useAccountSession } from "../app/features/account/useAccountSession";
import { clearStoredAccountSession, loadStoredAccountSession, storeAccountSession } from "../app/features/account/accountSessionStorage";
import { createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";

describe("useAccountSession", () => {
  beforeEach(() => {
    clearStoredAccountSession();
    window.localStorage.clear();
  });
  test("defaults to showing the lightweight login prompt when logged out", () => {
    const settingsStore = createSeededSettingsStore();

    const { result } = renderHook(() =>
      useAccountSession({
        getSettings: () => settingsStore.getState()
      })
    );

    expect(result.current.shouldShowLoginReminder).toBe(true);
  });

  test("can persist suppressing the lightweight login reminder", async () => {
    const settingsStore = createSeededSettingsStore();

    const { result } = renderHook(() =>
      useAccountSession({
        getSettings: () => settingsStore.getState()
      })
    );

    act(() => {
      result.current.setSuppressLoginReminder(true);
    });

    expect(result.current.shouldShowLoginReminder).toBe(false);

    const { result: nextResult } = renderHook(() =>
      useAccountSession({
        getSettings: () => settingsStore.getState()
      })
    );

    await waitFor(() => {
      expect(nextResult.current.shouldShowLoginReminder).toBe(false);
    });
  });

  test("does not expose the configured cloud endpoint when account login cannot reach the service", async () => {
    const settingsStore = createSeededSettingsStore({
      "models.control_plane_endpoint": "http://127.0.0.1:8787"
    });
    const { result } = renderHook(() =>
      useAccountSession({
        accountTransport: async () => {
          throw new TypeError("Failed to fetch");
        },
        getSettings: () => settingsStore.getState()
      })
    );

    await act(async () => {
      await result.current.loginPersonalAccount({
        email: "researcher@example.com",
        password: "a-secure-password"
      });
    });

    await waitFor(() => {
      expect(result.current.accountPending).toBe(false);
    });
    expect(result.current.accountSession).toBeNull();
    expect(result.current.accountMessage).toContain("云端服务当前不可用，请检查网络连接后重试");
    expect(result.current.accountMessage).not.toContain("http://127.0.0.1:8787");
  });

  test("registers a local development account without persisting its token in browser storage", async () => {
    const settingsStore = createSeededSettingsStore({
      "models.control_plane_endpoint": "http://127.0.0.1:8787"
    });
    const requests: string[] = [];
    const { result } = renderHook(() =>
      useAccountSession({
        accountTransport: async (request) => {
          requests.push(request.body);

          return {
            json: async () => ({
              session: {
                email: "tian@example.com",
                expiresAt: "2026-06-30T09:30:00Z",
                membershipTier: "pro",
                name: "Tian",
                sessionId: "account-session-tian-example-com"
              }
            }),
            ok: true,
            status: 200
          };
        },
        getSettings: () => settingsStore.getState()
      })
    );

    await act(async () => {
      await result.current.registerPersonalAccount({
        displayName: "Tian",
        email: "tian@example.com",
        password: "private-password-1"
      });
    });

    expect(requests).toEqual([
      JSON.stringify({
        displayName: "Tian",
        email: "tian@example.com",
        password: "private-password-1"
      })
    ]);
    expect(result.current.accountSession).toEqual({
      email: "tian@example.com",
      expiresAt: "2026-06-30T09:30:00Z",
      membershipTier: "pro",
      name: "Tian",
      sessionId: "account-session-tian-example-com"
    });
    expect(result.current.accountMessage).toBe("本地开发账号已创建；会话仅在本次运行期间保留。");
    expect(window.localStorage.getItem("liteasy.account.session.v1")).toBeNull();
  });

  test("removes a legacy browser-stored token instead of restoring it", async () => {
    window.localStorage.setItem(
      "liteasy.account.session.v1",
      JSON.stringify({
        email: "researcher@liteasy.dev",
        expiresAt: "2026-05-15T09:30:00Z",
        membershipTier: "pro",
        name: "Liteasy Researcher",
        sessionId: "demo-session-1"
      })
    );
    const settingsStore = createSeededSettingsStore();

    const { result } = renderHook(() =>
      useAccountSession({
        getSettings: () => settingsStore.getState()
      })
    );

    await waitFor(() => {
      expect(window.localStorage.getItem("liteasy.account.session.v1")).toBeNull();
    });
    expect(result.current.accountSession).toBeNull();
  });

  test("restores a formal session only through the Tauri secure-credential command", async () => {
    const accessToken = `eyJ.${"a".repeat(40)}.sig`;
    const onSessionRestored = vi.fn();
    const invoke = vi.fn(async (command: string) => {
      expect(command).toBe("restore_desktop_oauth_session");
      return {
        email: "tian@example.com",
        expiresAt: "2026-07-10T09:30:00Z",
        name: "Tian",
        sessionId: accessToken,
        userId: "user-1"
      };
    });
    const identityConfig = {
      audience: "liteasy-desktop",
      authorizationFlow: "authorization_code_pkce",
      clientId: "liteasy-desktop-public",
      issuer: "https://identity.example.com",
      revocationUrl: "https://identity.example.com/oauth2/revoke"
    };
    const settingsStore = createSeededSettingsStore({
      "models.control_plane_endpoint": "https://api.liteasy.example"
    });

    const { result } = renderHook(() =>
      useAccountSession({
        desktopIdentityFetch: vi.fn(async () => new Response(JSON.stringify(identityConfig), {
          headers: { "Content-Type": "application/json" },
          status: 200
        })) as typeof fetch,
        desktopIdentityHostAvailable: true,
        desktopIdentityInvoke: invoke,
        getSettings: () => settingsStore.getState(),
        onSessionRestored
      })
    );

    await waitFor(() => {
      expect(result.current.accountMessage).toBe("登录会话已从操作系统安全存储恢复。");
    });
    expect(invoke).toHaveBeenCalledWith("restore_desktop_oauth_session", {
      configuration: identityConfig
    });
    expect(result.current.accountSession?.userId).toBe("user-1");
    expect(result.current.accountSession?.membershipTier).toBe("basic");
    expect(window.localStorage.getItem("liteasy.account.session.v1")).toBeNull();
    expect(onSessionRestored).toHaveBeenCalledTimes(1);
  });

});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const sessionFor = (id: string) => ({
  email: `${id}@example.test`, expiresAt: "2027-01-01T00:00:00Z", name: id,
  sessionId: `ltsy_${id}`, userId: id, membershipTier: "basic" as const
});
const responseFor = (id: string) => ({ ok: true, status: 200, json: async () => ({ session: sessionFor(id) }) });

describe("account request isolation", () => {
  beforeEach(() => { clearStoredAccountSession(); localStorage.clear(); });

  test("ignores a late login after logout and a newer account login", async () => {
    const old = deferred<ReturnType<typeof responseFor>>();
    const settings = createSeededSettingsStore({ "models.control_plane_endpoint": "http://127.0.0.1:8787" });
    const { result } = renderHook(() => useAccountSession({
      accountTransport: async (request) => JSON.parse(request.body).email === "A@example.test" ? old.promise : responseFor("B"),
      getSettings: () => settings.getState()
    }));
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.loginPersonalAccount({ email: "A@example.test", password: "synthetic" }); });
    act(() => { result.current.logoutFromCloudAccount(); });
    await act(async () => { await result.current.loginPersonalAccount({ email: "B@example.test", password: "synthetic" }); });
    await act(async () => { old.resolve(responseFor("A")); expect(await pending).toBeNull(); });
    expect(result.current.accountSession?.userId).toBe("B");
    expect(loadStoredAccountSession()?.userId).toBe("B");
  });

  test("a stale validation rejection cannot clear the newer account", async () => {
    storeAccountSession(sessionFor("A"));
    const validation = deferred<{ ok: boolean; status: number; json: () => Promise<unknown> }>();
    const settings = createSeededSettingsStore({ "models.control_plane_endpoint": "http://127.0.0.1:8787" });
    const { result } = renderHook(() => useAccountSession({
      accountTransport: async (request) => request.url.endsWith("/session") ? validation.promise : responseFor("B"),
      getSettings: () => settings.getState()
    }));
    await act(async () => { await result.current.loginPersonalAccount({ email: "B@example.test", password: "synthetic" }); });
    await act(async () => { validation.resolve({ ok: false, status: 401, json: async () => ({}) }); });
    expect(result.current.accountSession?.userId).toBe("B");
    expect(loadStoredAccountSession()?.userId).toBe("B");
  });

  test.each([503, 403])("does not turn a %s validation failure into logout or delete local reading data", async (status) => {
    storeAccountSession(sessionFor("A"));
    localStorage.setItem("liteasy.local-literature.v1", "synthetic local reading data");
    const settings = createSeededSettingsStore({ "models.control_plane_endpoint": "http://127.0.0.1:8787" });
    const { result } = renderHook(() => useAccountSession({
      accountTransport: async () => ({ ok: false, status, json: async () => ({}) }),
      getSettings: () => settings.getState()
    }));
    await waitFor(() => expect(result.current.accountMessage).not.toBe("已恢复本地云账号会话。"));
    expect(result.current.accountSession?.userId).toBe("A");
    expect(loadStoredAccountSession()?.userId).toBe("A");
    expect(localStorage.getItem("liteasy.local-literature.v1")).toBe("synthetic local reading data");
    expect(result.current.accountMessage).not.toContain("过期");
  });

  test("a newer login stays pending when an old login completes", async () => {
    const first = deferred<ReturnType<typeof responseFor>>();
    const second = deferred<ReturnType<typeof responseFor>>();
    const settings = createSeededSettingsStore({ "models.control_plane_endpoint": "http://127.0.0.1:8787" });
    const { result } = renderHook(() => useAccountSession({
      accountTransport: async (request) => JSON.parse(request.body).email === "A@example.test" ? first.promise : second.promise,
      getSettings: () => settings.getState()
    }));
    let a!: Promise<unknown>; let b!: Promise<unknown>;
    act(() => { a = result.current.loginPersonalAccount({ email: "A@example.test", password: "synthetic" }); });
    act(() => { b = result.current.loginPersonalAccount({ email: "B@example.test", password: "synthetic" }); });
    await act(async () => { first.resolve(responseFor("A")); await a; });
    expect(result.current.accountPending).toBe(true);
    await act(async () => { second.resolve(responseFor("B")); await b; });
    expect(result.current.accountSession?.userId).toBe("B");
  });

  test("does not store an authentication response after unmount", async () => {
    const request = deferred<ReturnType<typeof responseFor>>();
    const settings = createSeededSettingsStore({ "models.control_plane_endpoint": "http://127.0.0.1:8787" });
    const { result, unmount } = renderHook(() => useAccountSession({ accountTransport: () => request.promise, getSettings: () => settings.getState() }));
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.registerPersonalAccount({ displayName: "A", email: "A@example.test", password: "synthetic" }); });
    unmount();
    await act(async () => { request.resolve(responseFor("A")); await pending; });
    expect(loadStoredAccountSession()).toBeNull();
  });

  test("logout fences a late native restore and reports unconfirmed remote revocation", async () => {
    const restored = deferred<ReturnType<typeof sessionFor>>();
    const settings = createSeededSettingsStore({ "models.control_plane_endpoint": "https://api.example.test" });
    const invoke = vi.fn(async (command: string) => command === "restore_desktop_oauth_session"
      ? restored.promise : { localCleared: true, remoteRevocation: "unconfirmed" });
    const identityConfig = { audience: "liteasy-desktop", authorizationFlow: "authorization_code_pkce", clientId: "liteasy-desktop-public", issuer: "https://identity.example.test", revocationUrl: "https://identity.example.test/revoke" };
    const { result } = renderHook(() => useAccountSession({
      desktopIdentityHostAvailable: true,
      desktopIdentityInvoke: invoke,
      desktopIdentityFetch: async () => new Response(JSON.stringify(identityConfig), { status: 200 }),
      getSettings: () => settings.getState()
    }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("restore_desktop_oauth_session", { configuration: identityConfig }));
    act(() => { result.current.logoutFromCloudAccount(); });
    await waitFor(() => expect(result.current.accountMessage).toBe("当前设备的登录凭据已清除；远程会话撤销尚未确认。"));
    await act(async () => { restored.resolve(sessionFor("A")); });
    expect(result.current.accountSession).toBeNull();
    expect(loadStoredAccountSession()).toBeNull();
    expect(result.current.accountPending).toBe(false);
  });

});
