import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useAccountSession } from "../app/features/account/useAccountSession";
import { createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";

describe("useAccountSession", () => {
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
    expect(result.current.accountMessage).toContain("请确认已启动 http://127.0.0.1:8787");
  });
  test("notifies the shell when a stored session is restored", async () => {
    window.localStorage.setItem(
      "liteasy.account.session.v1",
      JSON.stringify({
        email: "researcher@liteasy.dev",
        expiresAt: "2026-05-15T09:30:00Z",
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

});
