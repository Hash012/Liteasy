import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, test } from "vitest";
import { useDockLayout } from "../app/features/dock/useDockLayout";
import { useWorkbenchNavigationController } from "../app/controllers/useWorkbenchNavigationController";

beforeEach(() => localStorage.clear());
function useFixture() {
  const dock = useDockLayout();
  const [collapsed, setCollapsed] = useState({
    left: false,
    right: true,
    bottom: true,
  });
  const [board, setBoard] = useState(true);
  const navigation = useWorkbenchNavigationController({
    dock,
    collapsed,
    setCollapsed: (region, value) =>
      setCollapsed((current) => ({ ...current, [region]: value })),
    boardVisible: board,
    closeBoard: () => setBoard(false),
    activate: dock.activateItem,
    activeDynamicItems: {},
  });
  return { dock, collapsed, board, navigation };
}
test("Agent can reopen after close and reveal a collapsed right region alongside the board", () => {
  const { result } = renderHook(useFixture);
  act(() => result.current.dock.closeItem("assistant"));
  expect(result.current.navigation.isVisible("assistant")).toBe(false);
  act(() => result.current.navigation.open("assistant"));
  expect(result.current.dock.layout.regions.right.activeItemId).toBe(
    "assistant",
  );
  expect(result.current.collapsed.right).toBe(false);
  expect(result.current.board).toBe(true);
  expect(result.current.navigation.isVisible("assistant")).toBe(true);
});
test("tool entries preserve moved regions and open help in its independent workspace tab", () => {
  const { result } = renderHook(useFixture);
  act(() => result.current.dock.moveItem("assistant", "bottom"));
  act(() => result.current.navigation.open("assistant"));
  expect(result.current.dock.findItemRegion("assistant")).toBe("bottom");
  expect(result.current.collapsed.bottom).toBe(false);
  act(() => result.current.navigation.open("help"));
  expect(result.current.dock.layout.regions.main.activeItemId).toBe("help");
  act(() => result.current.dock.closeItem("help"));
  act(() => result.current.navigation.open("help"));
  expect(result.current.navigation.isVisible("help")).toBe(true);
});

test("reopens a tool in a persisted split without touching other regions", () => {
  const { result } = renderHook(useFixture);
  act(() => {
    result.current.dock.splitRegion("main", "right", "bar-notes");
    result.current.dock.moveItem("notes", "bar-notes");
  });
  act(() => result.current.navigation.open("notes"));
  expect(result.current.navigation.isVisible("notes")).toBe(true);
  expect(result.current.collapsed.right).toBe(true);
  expect(result.current.dock.findItemRegion("notes")).toBe("bar-notes");
});

test("collapsing a split preserves its pages and activity navigation restores the same panel", () => {
  const { result } = renderHook(useFixture);
  act(() => {
    result.current.dock.splitRegion("main", "right", "bar-notes");
    result.current.dock.moveItem("notes", "bar-notes");
  });
  act(() => result.current.navigation.open("notes"));
  const layout = result.current.dock.layout;
  act(() => result.current.navigation.collapse("bar-notes"));
  expect(result.current.navigation.isVisible("notes")).toBe(false);
  expect(result.current.navigation.hiddenRegions).toEqual(["bar-notes"]);
  expect(result.current.dock.layout).toEqual(layout);
  act(() => result.current.navigation.open("notes"));
  expect(result.current.navigation.isVisible("notes")).toBe(true);
  expect(result.current.navigation.hiddenRegions).toEqual([]);
  expect(result.current.dock.findItemRegion("notes")).toBe("bar-notes");
});

test("closing a bottom split leaves its sibling visible and the last one collapses the row", () => {
  const { result } = renderHook(useFixture);
  act(() => result.current.dock.splitRegion("bottom", "right", "bar-bottom"));
  act(() => result.current.navigation.reveal("bottom"));
  act(() => result.current.navigation.collapse("bottom"));
  expect(result.current.collapsed.bottom).toBe(false);
  expect(result.current.navigation.hiddenRegions).toEqual(["bottom"]);
  act(() => result.current.navigation.collapse("bar-bottom"));
  expect(result.current.collapsed.bottom).toBe(true);
  act(() => result.current.navigation.reveal("bottom"));
  expect(result.current.collapsed.bottom).toBe(false);
  expect(result.current.navigation.hiddenRegions).toEqual(["bar-bottom"]);
});


test("settings opens in the center and relocates old sidebar placements without closing other tools", () => {
  const { result } = renderHook(useFixture);
  act(() => result.current.navigation.open("settings"));
  expect(result.current.dock.findItemRegion("settings")).toBe("main");
  expect(result.current.navigation.isVisible("settings")).toBe(true);
  act(() => result.current.dock.moveItem("settings", "left"));
  act(() => result.current.navigation.open("settings"));
  expect(result.current.dock.layout.regions.main.activeItemId).toBe("settings");
  expect(result.current.dock.layout.regions.left.itemIds).toContain("library");
  expect(result.current.dock.layout.regions.left.itemIds).not.toContain("settings");
  expect(result.current.dock.layout.regions.right.itemIds).toContain("assistant");
});

test("recommendation previews open in the main region while retaining the library and reader", () => {
  const { result } = renderHook(useFixture);
  act(() => result.current.navigation.open("document-reader"));
  act(() => result.current.navigation.open("recommendation-reader"));
  expect(result.current.dock.layout.regions.main.activeItemId).toBe("recommendation-reader");
  expect(result.current.dock.layout.regions.main.itemIds).toContain("document-reader");
  expect(result.current.dock.layout.regions.left.itemIds).toContain("library");
});
