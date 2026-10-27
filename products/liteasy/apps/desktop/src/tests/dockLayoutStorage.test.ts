import { beforeEach, expect, test } from "vitest";
import { createDefaultDockLayout, moveDockItem, openDockItem, splitDockRegion } from "../app/features/dock/dockLayout";
import { loadPaneLayoutPreference } from "../app/layout/paneLayout.storage";
import { defaultPaneLayout } from "../app/layout/paneLayout.types";
import {
  loadDockLayout,
  loadDynamicDockPlacements,
  saveDynamicDockPlacements,
  saveDockLayout
} from "../app/features/dock/dockLayout.storage";

beforeEach(() => localStorage.clear());

test("persists and restores the dock tab arrangement", () => {
  const movedLayout = moveDockItem(loadDockLayout(), "assistant", "right");
  saveDockLayout(movedLayout);

  const restored = loadDockLayout();
  expect(restored.regions.right.itemIds).toEqual(["assistant"]);
  expect(restored.regions.bottom.itemIds).toEqual([]);
  expect(restored.regions.right.activeItemId).toBe("assistant");
});

test.each(["liteasy.ui.dock-layout.v1", "liteasy.ui.dock-layout.v3"])("migrates the old default assistant and pane visibility once from %s", (key) => {
  const legacy = moveDockItem(createDefaultDockLayout(), "assistant", "right");
  localStorage.setItem(key, JSON.stringify({ ...legacy, version: key.endsWith("v1") ? 1 : 3 }));
  localStorage.setItem("liteasy.ui.pane-layout.v1", JSON.stringify({
    collapsed: { left: false, right: false, bottom: true }, layout: defaultPaneLayout
  }));
  expect(loadPaneLayoutPreference().collapsed).toEqual({ left: false, right: true, bottom: false });
  const migrated = loadDockLayout();
  expect(migrated.regions.bottom.itemIds).toEqual(["assistant"]);
  expect(migrated.regions.right.itemIds).toEqual([]);
  // Later explicit placement remains a preference, even when it resembles the old default.
  saveDockLayout(moveDockItem(migrated, "assistant", "right"));
  expect(loadDockLayout().regions.right.itemIds).toEqual(["assistant"]);
});

test("keeps existing populated bottom panes and custom split layouts", () => {
  const legacy = moveDockItem(createDefaultDockLayout(), "assistant", "right");
  const arrangements = [
    moveDockItem(openDockItem(legacy, "workflow-runs"), "workflow-runs", "bottom"),
    splitDockRegion(legacy, "main", "right", "bar-custom")
  ];
  for (const layout of arrangements) {
    localStorage.setItem("liteasy.ui.dock-layout.v3", JSON.stringify(layout));
    localStorage.setItem("liteasy.ui.pane-layout.v1", JSON.stringify({
      collapsed: { left: false, right: false, bottom: true }, layout: defaultPaneLayout
    }));
    expect(loadPaneLayoutPreference().collapsed).toEqual({ left: false, right: false, bottom: true });
    expect(loadDockLayout()).toEqual(layout);
  }
});

test("falls back to the default dock layout when storage is malformed", () => {
  window.localStorage.setItem("liteasy.ui.dock-layout.v1", "{broken");

  expect(loadDockLayout().regions.main.itemIds).toEqual([]);
  expect(loadDockLayout().regions.left.itemIds).toEqual(["library"]);
});

test("persists dynamic artifact tab regions and ignores invalid entries", () => {
  saveDynamicDockPlacements({
    "artifact-1": "right",
    "artifact-2": "bottom"
  });

  expect(loadDynamicDockPlacements()).toEqual({
    "artifact-1": "right",
    "artifact-2": "bottom"
  });

  window.localStorage.setItem(
    "liteasy.ui.dynamic-dock-placement.v1",
    JSON.stringify({ "artifact-invalid": "outside", "artifact-main": "main" })
  );
  expect(loadDynamicDockPlacements()).toEqual({ "artifact-main": "main" });
});
