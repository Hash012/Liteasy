import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useCloudAvailabilityProbe } from "../app/features/network/useCloudAvailabilityProbe";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCloudAvailabilityProbe", () => {
  test("treats mock endpoints as reachable in development", async () => {
    const { result } = renderHook(() =>
      useCloudAvailabilityProbe({
        enabled: true,
        endpoint: "mock://control-plane"
      })
    );

    expect(result.current.isCloudReachable).toBe(true);
  });

  test("marks cloud as unreachable when health probe fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));

    const { result } = renderHook(() =>
      useCloudAvailabilityProbe({
        enabled: true,
        endpoint: "https://liteasy.example.com/control-plane"
      })
    );

    await waitFor(() => {
      expect(result.current.isCloudReachable).toBe(false);
    });
  });

  test("marks cloud as reachable when health probe succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true
    })));

    const { result } = renderHook(() =>
      useCloudAvailabilityProbe({
        enabled: true,
        endpoint: "https://liteasy.example.com/control-plane"
      })
    );

    await waitFor(() => {
      expect(result.current.isCloudReachable).toBe(true);
    });
  });
});
