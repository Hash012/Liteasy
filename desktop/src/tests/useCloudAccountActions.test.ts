import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useCloudAccountActions } from "../app/features/account/useCloudAccountActions";

describe("useCloudAccountActions", () => {
  test("applies local dev-cloud defaults before logging in", async () => {
    const applyLocalDevCloudDefaults = vi.fn();
    const loginToCloudAccount = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() =>
      useCloudAccountActions({
        applyLocalDevCloudDefaults,
        clearOrganizationNotifications: vi.fn(),
        loginToCloudAccount,
        logoutFromCloudAccount: vi.fn(),
        resetOrganizationActions: vi.fn(),
        resetOrganizationSelection: vi.fn()
      })
    );

    await act(async () => {
      await result.current.loginWithLocalDevCloudDefaults();
    });

    expect(applyLocalDevCloudDefaults).toHaveBeenCalledTimes(1);
    expect(loginToCloudAccount).toHaveBeenCalledTimes(1);
    expect(applyLocalDevCloudDefaults.mock.invocationCallOrder[0]).toBeLessThan(
      loginToCloudAccount.mock.invocationCallOrder[0]
    );
  });

  test("clears organization session state after logout", () => {
    const clearOrganizationNotifications = vi.fn();
    const logoutFromCloudAccount = vi.fn();
    const resetOrganizationActions = vi.fn();
    const resetOrganizationSelection = vi.fn();
    const { result } = renderHook(() =>
      useCloudAccountActions({
        applyLocalDevCloudDefaults: vi.fn(),
        clearOrganizationNotifications,
        loginToCloudAccount: vi.fn(),
        logoutFromCloudAccount,
        resetOrganizationActions,
        resetOrganizationSelection
      })
    );

    act(() => result.current.logoutAndClearOrganizationState());

    expect(logoutFromCloudAccount).toHaveBeenCalledTimes(1);
    expect(clearOrganizationNotifications).toHaveBeenCalledTimes(1);
    expect(resetOrganizationActions).toHaveBeenCalledTimes(1);
    expect(resetOrganizationSelection).toHaveBeenCalledTimes(1);
  });
});
