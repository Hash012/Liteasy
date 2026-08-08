import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useLeftRailNavigation } from "../app/layout/useLeftRailNavigation";

describe("useLeftRailNavigation", () => {
  test("starts at library and switches between activity bar views", () => {
    const { result } = renderHook(() => useLeftRailNavigation());

    expect(result.current.leftRailView).toBe("library");
    expect(result.current.paneHeader).toBe("Library");

    act(() => result.current.openArtifactLibrary());
    expect(result.current.leftRailView).toBe("artifact-library");
    expect(result.current.paneHeader).toBe("产物库");

    act(() => result.current.openOrganization());
    expect(result.current.leftRailView).toBe("organization");
    expect(result.current.paneHeader).toBe("Organization");

    act(() => result.current.openProfile());
    expect(result.current.leftRailView).toBe("profile");
    expect(result.current.paneHeader).toBe("Profile");

    act(() => result.current.openSettings());
    expect(result.current.leftRailView).toBe("settings");
    expect(result.current.paneHeader).toBe("Settings");

    act(() => result.current.openLibrary());
    expect(result.current.leftRailView).toBe("library");
    expect(result.current.paneHeader).toBe("Library");
  });

  test("accepts a direct view setter for hooks that need library switching", () => {
    const { result } = renderHook(() => useLeftRailNavigation());

    act(() => result.current.setLeftRailView("organization"));
    expect(result.current.leftRailView).toBe("organization");

    act(() => result.current.setLeftRailView("library"));
    expect(result.current.leftRailView).toBe("library");
  });
});
