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

  test("submits real account login through cloud account actions and closes the dialog", async () => {
    const input = createControllerInput();
    const accountCapabilitiesTransport = vi.fn(async () => ({
      json: async () => ({ developerDiagnostics: true }),
      ok: true,
      status: 200
    }));
    const accountTransport = vi.fn(async () => ({
      json: async () => ({
        session: {
          email: "researcher@liteasy.dev",
          expiresAt: "2026-05-15T09:30:00Z",
          membershipTier: "pro" as const,
          name: "Liteasy Researcher",
          sessionId: "ltsy_session_1"
        }
      }),
      ok: true,
      status: 200
    }));

    const { result } = renderHook(() =>
      useCloudAccountController({
        ...input,
        accountCapabilitiesTransport,
        accountTransport
      })
    );

    await waitFor(() => {
      expect(result.current.model.loginDialogOpen).toBe(true);
    });

    await act(async () => {
      await result.current.actions.submitAccountLogin({
        email: "researcher@liteasy.dev",
        password: "a-secure-password"
      });
    });

    expect(input.applyLocalDevCloudDefaults).toHaveBeenCalledTimes(1);
    expect(accountTransport).toHaveBeenCalledTimes(1);
    expect(result.current.model.accountSession?.sessionId).toBe("ltsy_session_1");
    await waitFor(() => {
      expect(result.current.model.developerDiagnostics).toBe(true);
    });
    expect(accountCapabilitiesTransport).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer ltsy_session_1" }),
      method: "GET"
    }));
    expect(result.current.model.loginDialogOpen).toBe(false);
  });

  test("notifies the shell only after a successful account registration", async () => {
    const input = createControllerInput();
    const onRegistered = vi.fn();
    const accountTransport = vi.fn(async () => ({
      json: async () => ({
        session: {
          email: "tian@example.com",
          expiresAt: "2026-12-31T23:59:59.000Z",
          membershipTier: "pro" as const,
          name: "Tian",
          sessionId: "account-session-tian-example-com"
        }
      }),
      ok: true,
      status: 200
    }));

    const { result } = renderHook(() =>
      useCloudAccountController({
        ...input,
        accountTransport,
        onRegistered
      })
    );

    await act(async () => {
      await result.current.actions.submitAccountRegistration({
        displayName: "Tian",
        email: "tian@example.com",
        password: "private-password-1"
      });
    });

    expect(onRegistered).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.actions.submitAccountLogin({
        email: "tian@example.com",
        password: "private-password-1"
      });
    });

    expect(onRegistered).toHaveBeenCalledTimes(1);
  });

  test("applies a returned multimodal preference capability immediately", async () => {
    const input = createControllerInput();
    const accountCapabilitiesTransport = vi.fn(async () => ({
      json: async () => ({
        developerDiagnostics: false,
        multimodalVisualization: {
          allowed: true,
          enabled: true,
          serviceAvailable: true,
          explicitRequestsAllowed: true,
          quota: { available: true },
          availableModalities: ["semantic_graph"]
        }
      }),
      ok: true,
      status: 200
    }));
    const accountTransport = vi.fn(async () => ({
      json: async () => ({
        session: {
          email: "researcher@liteasy.dev",
          expiresAt: "2026-05-15T09:30:00Z",
          membershipTier: "pro" as const,
          name: "Liteasy Researcher",
          sessionId: "ltsy_session_1"
        }
      }),
      ok: true,
      status: 200
    }));
    const { result } = renderHook(() => useCloudAccountController({
      ...input,
      accountCapabilitiesTransport,
      accountTransport
    }));

    await act(async () => {
      await result.current.actions.submitAccountLogin({
        email: "researcher@liteasy.dev",
        password: "a-secure-password"
      });
    });
    await waitFor(() => expect(result.current.model.multimodalVisualization.enabled).toBe(true));

    act(() => {
      result.current.actions.setMultimodalVisualizationCapability({
        allowed: true,
        enabled: false,
        serviceAvailable: true,
        explicitRequestsAllowed: true,
        quota: { available: true },
        availableModalities: ["semantic_graph"]
      });
    });

    expect(result.current.model.multimodalVisualization.enabled).toBe(false);

    act(() => {
      result.current.actions.setMultimodalVisualizationCapability({
        allowed: false,
        enabled: false,
        serviceAvailable: false,
        explicitRequestsAllowed: false,
        quota: { available: false },
        availableModalities: []
      });
    });
    expect(result.current.model.multimodalVisualization).toMatchObject({
      allowed: false,
      enabled: false,
      serviceAvailable: false
    });
  });
});
