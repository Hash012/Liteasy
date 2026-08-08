import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useConnectivity } from "../app/features/network/useConnectivity";

describe("useConnectivity", () => {
  test("reflects browser online and offline events", () => {
    const { result } = renderHook(() => useConnectivity());

    expect(result.current.isOnline).toBe(true);

    act(() => {
      Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        value: false
      });
      window.dispatchEvent(new Event("offline"));
    });

    expect(result.current.isOnline).toBe(false);

    act(() => {
      Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        value: true
      });
      window.dispatchEvent(new Event("online"));
    });

    expect(result.current.isOnline).toBe(true);
  });
});
