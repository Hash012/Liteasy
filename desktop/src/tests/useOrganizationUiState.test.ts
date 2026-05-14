import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useOrganizationUiState } from "../app/features/organization/useOrganizationUiState";

describe("useOrganizationUiState", () => {
  test("tracks organization dialog open state", () => {
    const { result } = renderHook(() => useOrganizationUiState());

    expect(result.current.organizationDialogOpen).toBe(false);

    act(() => result.current.openOrganizationDialog());
    expect(result.current.organizationDialogOpen).toBe(true);

    act(() => result.current.closeOrganizationDialog());
    expect(result.current.organizationDialogOpen).toBe(false);
  });

  test("derives active organization id from selection or list fallback", () => {
    const { result } = renderHook(() => useOrganizationUiState());

    expect(result.current.getActiveOrganizationId("org-demo-1")).toBe("org-demo-1");

    act(() => result.current.selectOrganization("org-demo-2"));
    expect(result.current.selectedOrganizationId).toBe("org-demo-2");
    expect(result.current.getActiveOrganizationId("org-demo-1")).toBe("org-demo-2");

    act(() => result.current.resetOrganizationSelection());
    expect(result.current.selectedOrganizationId).toBeUndefined();
    expect(result.current.getActiveOrganizationId("org-demo-1")).toBe("org-demo-1");
  });
});
