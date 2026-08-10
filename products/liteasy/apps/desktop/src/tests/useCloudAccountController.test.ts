import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useCloudAccountController } from "../app/controllers/useCloudAccountController";
import { clearStoredAccountSession } from "../app/features/account/accountSessionStorage";
import { createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";
import { availableCapability, readyArtifact } from "./fixtures/visualizationControllerFixtures";

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
  beforeEach(() => {
    clearStoredAccountSession();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

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

  test("composes authenticated visualization requests with account scope", async () => {
    const input = createControllerInput();
    const accountTransport = vi.fn(async () => ({
      json: async () => ({
        session: {
          email: "researcher@liteasy.dev",
          expiresAt: "2026-12-31T23:59:59.000Z",
          membershipTier: "pro" as const,
          name: "Liteasy Researcher",
          sessionId: "ltsy_session_visualization",
          userId: "user-visualization-1"
        }
      }),
      ok: true,
      status: 200
    }));
    const accountCapabilitiesTransport = vi.fn(async () => ({
      json: async () => ({
        developerDiagnostics: false,
        multimodalVisualization: availableCapability
      }),
      ok: true,
      status: 200
    }));
    const visualizationFetch = vi.fn(async () => ({
      json: async () => ({
        artifacts: [readyArtifact],
        requestId: "visualization-account-request",
        resultArtifactIds: [readyArtifact.artifactId],
        status: "succeeded"
      }),
      ok: true,
      status: 200
    }));
    const { result } = renderHook(() => useCloudAccountController({
      ...input,
      accountCapabilitiesTransport,
      accountTransport,
      visualizationFetch: visualizationFetch as unknown as typeof fetch,
      visualizationStorage: window.localStorage
    }));

    await act(async () => {
      await result.current.actions.submitAccountLogin({
        email: "researcher@liteasy.dev",
        password: "a-secure-password"
      });
    });
    await waitFor(() => expect(result.current.model.multimodalVisualization.enabled).toBe(true));

    const signal = new AbortController().signal;
    await act(async () => {
      await expect(result.current.actions.generateVisualization({
        artifactId: "thin-1",
        candidateModalities: ["semantic_graph"],
        evidenceIds: ["evidence-1"],
        nodeId: "node-root",
        purpose: "show_process",
        requestId: "visualization-account-request",
        requestedArtifactCount: 1,
        signal
      })).resolves.toEqual([readyArtifact]);
    });

    expect(visualizationFetch).toHaveBeenCalledTimes(1);
    expect(visualizationFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/v1/account/visualization/requests",
      expect.objectContaining({
        body: JSON.stringify({
          artifactId: "thin-1",
          nodeId: "node-root",
          requestId: "visualization-account-request",
          requestedArtifactCount: 1
        }),
        headers: {
          Accept: "application/json",
          Authorization: "Bearer ltsy_session_visualization",
          "Content-Type": "application/json"
        },
        method: "POST",
        signal
      })
    );
    expect(result.current.actions.pendingVisualizationRequests()).toEqual([]);
    expect([...Array(window.localStorage.length)].map((_, index) => (
      window.localStorage.key(index)
    )).filter(Boolean)).not.toEqual(expect.arrayContaining([
      expect.stringContaining("ltsy_session_visualization")
    ]));
  });

  test("fails closed without an authenticated visualization account", async () => {
    const visualizationFetch = vi.fn();
    const { result } = renderHook(() => useCloudAccountController({
      ...createControllerInput(),
      visualizationFetch: visualizationFetch as unknown as typeof fetch,
      visualizationStorage: window.localStorage
    }));
    const request = {
      artifactId: "thin-1",
      candidateModalities: ["semantic_graph" as const],
      evidenceIds: ["evidence-1"],
      nodeId: "node-root",
      purpose: "show_process" as const,
      requestId: "visualization-unauthenticated",
      requestedArtifactCount: 1 as const,
      signal: new AbortController().signal
    };

    await expect(result.current.actions.generateVisualization(request)).rejects.toThrow(
      "visualization_account_session_required"
    );
    await expect(result.current.actions.resumeVisualizationGeneration({
      artifactId: "thin-1",
      createdAt: "2026-08-10T08:00:00.000Z",
      nodeId: "node-root",
      requestId: "visualization-unauthenticated",
      requestedArtifactCount: 1
    }, request.signal)).rejects.toThrow("visualization_account_session_required");
    await result.current.actions.cancelVisualizationGeneration({
      artifactId: "thin-1",
      nodeId: "node-root",
      reason: "workflow_disposed",
      requestId: "visualization-unauthenticated"
    });

    expect(result.current.actions.pendingVisualizationRequests()).toEqual([]);
    expect(visualizationFetch).not.toHaveBeenCalled();
  });
});
