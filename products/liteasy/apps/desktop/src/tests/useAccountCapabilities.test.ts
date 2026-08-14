import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useAccountCapabilities } from "../app/features/account/useAccountCapabilities";
import type { AccountSession } from "../app/features/account/account.types";

function session(sessionId: string): AccountSession {
  return {
    email: `${sessionId}@example.com`,
    expiresAt: "2026-08-08T00:00:00.000Z",
    name: sessionId,
    sessionId,
    userId: sessionId
  };
}

const unavailableMultimodalCapability = {
  allowed: false,
  enabled: false,
  serviceAvailable: false,
  explicitRequestsAllowed: false,
  quota: { available: false },
  availableModalities: []
};

test("fails closed while signed out and when the capability service is unavailable", async () => {
  const transport = vi.fn(async () => {
    throw new Error("network unavailable");
  });
  const { result, rerender } = renderHook(
    ({ accountSession }) => useAccountCapabilities({
      accountSession,
      endpoint: "https://api.liteasy.example",
      transport
    }),
    { initialProps: { accountSession: null as AccountSession | null } }
  );
  expect(result.current.developerDiagnostics).toBe(false);
  expect(result.current.multimodalVisualization).toEqual(unavailableMultimodalCapability);
  expect(transport).not.toHaveBeenCalled();

  rerender({ accountSession: session("account-a") });
  await waitFor(() => expect(transport).toHaveBeenCalledOnce());
  expect(result.current.developerDiagnostics).toBe(false);
  expect(result.current.multimodalVisualization).toEqual(unavailableMultimodalCapability);
});

test("does not retain a stale allowed capability after refresh fails", async () => {
  let calls = 0;
  const transport = vi.fn(async () => {
    calls += 1;
    if (calls === 1) {
      return {
        json: async () => ({
          developerDiagnostics: false,
          multimodalVisualization: {
            allowed: true,
            enabled: true,
            serviceAvailable: true,
            explicitRequestsAllowed: false,
            quota: { available: true },
            availableModalities: ["semantic_graph"]
          }
        }),
        ok: true,
        status: 200
      };
    }
    throw new Error("network");
  });
  const { result, rerender } = renderHook(
    ({ accountSession, endpoint }) => useAccountCapabilities({
      accountSession,
      endpoint,
      transport
    }),
    { initialProps: { accountSession: session("account-a"), endpoint: "https://api.liteasy.example" } }
  );
  await waitFor(() => expect(result.current.multimodalVisualization.allowed).toBe(true));
  rerender({ accountSession: session("account-a"), endpoint: "https://api.liteasy.example/" });
  await waitFor(() => expect(result.current.multimodalVisualization.allowed).toBe(false));
});

test("refreshes an expired session and retries capability discovery once", async () => {
  const transport = vi.fn(async (request: { headers: Record<string, string> }) => {
    const authorized = request.headers.Authorization === "Bearer account-refreshed";
    return {
      json: async () => authorized ? ({
        developerDiagnostics: false,
        multimodalVisualization: {
          allowed: true,
          enabled: true,
          serviceAvailable: true,
          explicitRequestsAllowed: true,
          quota: { available: true },
          availableModalities: ["semantic_graph"]
        }
      }) : ({ code: "unauthorized" }),
      ok: authorized,
      status: authorized ? 200 : 401
    };
  });
  const refreshSession = vi.fn(async () => session("account-refreshed"));
  const { result } = renderHook(() => useAccountCapabilities({
    accountSession: session("account-expired"),
    endpoint: "https://api.liteasy.example",
    refreshSession,
    transport
  }));
  await waitFor(() => expect(result.current.multimodalVisualization.allowed).toBe(true));
  expect(refreshSession).toHaveBeenCalledTimes(1);
  expect(transport).toHaveBeenCalledTimes(2);
});

test("does not restore a previous account capability after an account switch", async () => {
  let resolveAccountA: ((value: {
    json: () => Promise<unknown>;
    ok: boolean;
    status: number;
  }) => void) | undefined;
  const transport = vi.fn((request: { headers: Record<string, string> }) => {
    if (request.headers.Authorization === "Bearer account-a") {
      return new Promise<{
        json: () => Promise<unknown>;
        ok: boolean;
        status: number;
      }>((resolve) => { resolveAccountA = resolve; });
    }
    return Promise.resolve({
      json: async () => ({ developerDiagnostics: false }),
      ok: true,
      status: 200
    });
  });
  const { result, rerender } = renderHook(
    ({ accountSession }) => useAccountCapabilities({
      accountSession,
      endpoint: "https://api.liteasy.example",
      transport
    }),
    { initialProps: { accountSession: session("account-a") } }
  );
  await waitFor(() => expect(transport).toHaveBeenCalledOnce());
  rerender({ accountSession: session("account-b") });
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
  resolveAccountA?.({
    json: async () => ({ developerDiagnostics: true }),
    ok: true,
    status: 200
  });
  await Promise.resolve();
  expect(result.current.developerDiagnostics).toBe(false);
});

test("exposes explicit refresh and invalidation and fails closed synchronously on session changes", async () => {
  const transport = vi.fn(async () => ({
    json: async () => ({
      developerDiagnostics: false,
      multimodalVisualization: {
        allowed: true,
        enabled: true,
        serviceAvailable: true,
        explicitRequestsAllowed: false,
        quota: { available: true },
        availableModalities: ["semantic_graph"]
      }
    }),
    ok: true,
    status: 200
  }));
  const { result, rerender } = renderHook(
    ({ accountSession }) => useAccountCapabilities({
      accountSession,
      endpoint: "https://api.liteasy.example",
      transport
    }),
    { initialProps: { accountSession: session("account-a") } }
  );
  await waitFor(() => expect(result.current.multimodalVisualization.allowed).toBe(true));
  expect(typeof result.current.refresh).toBe("function");
  expect(typeof result.current.invalidate).toBe("function");
  act(() => result.current.invalidate());
  rerender({ accountSession: session("account-a") });
  expect(result.current.multimodalVisualization.allowed).toBe(false);
  rerender({ accountSession: session("account-b") });
  expect(result.current.multimodalVisualization.allowed).toBe(false);
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
});
