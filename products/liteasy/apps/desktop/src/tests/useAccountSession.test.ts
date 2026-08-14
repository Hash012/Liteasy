import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useAccountSession } from "../app/features/account/useAccountSession";
import { clearStoredAccountSession } from "../app/features/account/accountSessionStorage";
import { createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";

describe("useAccountSession", () => {
  beforeEach(() => {
    vi.useRealTimers();
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
    const invoke = vi.fn(async (command: string) => {
      expect(command).toBe("restore_desktop_oauth_session");
      return {
        email: "tian@example.com",
        expiresAt: "2099-07-10T09:30:00Z",
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
        getSettings: () => settingsStore.getState()
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
    expect(settingsStore.getState()["models.control_plane_endpoint"]).toBe("https://api.liteasy.example");
  });

  test("refreshes a formal OAuth session before its access token expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T09:00:00Z"));
    const invoke = vi.fn(async (command: string) => ({
      email: "tian@example.com",
      expiresAt: command === "begin_desktop_oauth_login"
        ? "2026-08-14T09:01:30Z"
        : "2026-08-14T10:00:30Z",
      name: "Tian",
      sessionId: command === "begin_desktop_oauth_login" ? "access-token-1" : "access-token-2",
      userId: "user-1"
    }));
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
    const { result } = renderHook(() => useAccountSession({
      desktopIdentityFetch: vi.fn(async () => new Response(JSON.stringify(identityConfig), {
        headers: { "Content-Type": "application/json" },
        status: 200
      })) as typeof fetch,
      desktopIdentityHostAvailable: true,
      desktopIdentityInvoke: invoke,
      getSettings: () => settingsStore.getState()
    }));

    await act(async () => {
      await result.current.loginPersonalAccountWithSystemBrowser();
    });
    expect(result.current.accountSession?.sessionId).toBe("access-token-1");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(invoke).toHaveBeenLastCalledWith("restore_desktop_oauth_session", {
      configuration: identityConfig
    });
    expect(result.current.accountSession?.sessionId).toBe("access-token-2");
    expect(result.current.accountMessage).toBe("登录会话已自动续期。");
  });

});
