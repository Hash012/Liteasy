import { expect, test } from "vitest";
import { moveDockItem } from "../app/features/dock/dockLayout";
import {
  loadDockLayout,
  loadDynamicDockPlacements,
  saveDynamicDockPlacements,
  saveDockLayout
} from "../app/features/dock/dockLayout.storage";

test("persists and restores the dock tab arrangement", () => {
  const movedLayout = moveDockItem(loadDockLayout(), "assistant", "bottom");
  saveDockLayout(movedLayout);

  const restored = loadDockLayout();
  expect(restored.regions.right.itemIds).toEqual([]);
  expect(restored.regions.bottom.itemIds).toEqual(["assistant"]);
  expect(restored.regions.bottom.activeItemId).toBe("assistant");
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
