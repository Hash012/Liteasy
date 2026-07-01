import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useCloudAccountController } from "../app/controllers/useCloudAccountController";
import { createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";

function createControllerInput() {
  const settingsStore = createSeededSettingsStore({
    "models.control_plane_endpoint": "http://127.0.0.1:8787"
  });

  return {
    applyLocalDevCloudDefaults: vi.fn(),
    getSettings: () => settingsStore.getState(),
    isOnline: true
  };
}

describe("useCloudAccountController", () => {
  test("opens the login dialog when the logged-out reminder is active", async () => {
    const input = createControllerInput();

    const { result } = renderHook(() => useCloudAccountController(input));

    await waitFor(() => {
      expect(result.current.model.loginDialogOpen).toBe(true);
    });
    expect(result.current.model.cloudAvailabilityStatus).toBe("unavailable");
  });

  test("submits demo login through cloud account actions and closes the dialog", async () => {
    const input = createControllerInput();
    const accountTransport = vi.fn(async () => ({
      json: async () => ({
        session: {
          email: "researcher@liteasy.dev",
          expiresAt: "2026-05-15T09:30:00Z",
          membershipTier: "pro" as const,
          name: "Liteasy Researcher",
          sessionId: "demo-session-1"
        }
      }),
      ok: true,
      status: 200
    }));

    const { result } = renderHook(() =>
      useCloudAccountController({
        ...input,
        accountTransport
      })
    );

    await waitFor(() => {
      expect(result.current.model.loginDialogOpen).toBe(true);
    });

    await act(async () => {
      await result.current.actions.submitDemoLogin();
    });

    expect(input.applyLocalDevCloudDefaults).toHaveBeenCalledTimes(1);
    expect(accountTransport).toHaveBeenCalledTimes(1);
    expect(result.current.model.accountSession?.sessionId).toBe("demo-session-1");
    expect(result.current.model.loginDialogOpen).toBe(false);
  });
});
