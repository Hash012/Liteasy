import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useAccountSession } from "../app/features/account/useAccountSession";
import { createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";

describe("useAccountSession", () => {
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

  test("shows a dev-cloud startup hint when demo login cannot reach the service", async () => {
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
      await result.current.loginToCloudAccount();
    });

    await waitFor(() => {
      expect(result.current.accountPending).toBe(false);
    });
    expect(result.current.accountSession).toBeNull();
    expect(result.current.accountMessage).toContain("请确认服务已启动，并检查当前云端地址：http://127.0.0.1:8787");
  });

  test("registers a personal account and persists the returned session", async () => {
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
    expect(result.current.accountMessage).toBe("已注册并登录云账号，会话已保存在本地。");
    expect(window.localStorage.getItem("liteasy.account.session.v1")).toContain("tian@example.com");
  });

  test("notifies the shell when a stored session is restored", async () => {
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
    const onSessionRestored = vi.fn();
    const settingsStore = createSeededSettingsStore();

    const { result } = renderHook(() =>
      useAccountSession({
        getSettings: () => settingsStore.getState(),
        onSessionRestored
      })
    );

    await waitFor(() => {
      expect(result.current.accountSession?.sessionId).toBe("demo-session-1");
    });
    expect(onSessionRestored).toHaveBeenCalledTimes(1);
  });

  test("revalidates a persisted secure session with the server", async () => {
    const sessionId = `ltsy_${"a".repeat(43)}`;
    window.localStorage.setItem(
      "liteasy.account.session.v1",
      JSON.stringify({
        email: "tian@example.com",
        expiresAt: "2026-07-10T09:30:00Z",
        membershipTier: "pro",
        name: "Tian",
        sessionId,
        userId: "user-1"
      })
    );
    const requestedUrls: string[] = [];
    const settingsStore = createSeededSettingsStore({
      "models.control_plane_endpoint": "http://127.0.0.1:8787"
    });

    const { result } = renderHook(() =>
      useAccountSession({
        accountTransport: async (request) => {
          requestedUrls.push(request.url);
          return {
            json: async () => ({
              session: {
                email: "tian@example.com",
                expiresAt: "2026-07-10T09:30:00Z",
                membershipTier: "pro",
                name: "Tian",
                sessionId,
                userId: "user-1"
              }
            }),
            ok: true,
            status: 200
          };
        },
        getSettings: () => settingsStore.getState()
      })
    );

    await waitFor(() => {
      expect(result.current.accountMessage).toBe("云账号会话有效。");
    });
    expect(requestedUrls).toEqual(["http://127.0.0.1:8787/v1/account/session"]);
    expect(result.current.accountSession?.userId).toBe("user-1");
  });

});
