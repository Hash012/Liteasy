import { renderHook, waitFor } from "@testing-library/react";
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
  expect(transport).not.toHaveBeenCalled();

  rerender({ accountSession: session("account-a") });
  await waitFor(() => expect(transport).toHaveBeenCalledOnce());
  expect(result.current.developerDiagnostics).toBe(false);
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
