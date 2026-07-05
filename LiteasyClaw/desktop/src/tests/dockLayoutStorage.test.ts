import { expect, test } from "vitest";
import { moveDockItem } from "../app/features/dock/dockLayout";
import {
  loadDockLayout,
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

  expect(loadDockLayout().regions.main.itemIds).toEqual(["reader"]);
  expect(loadDockLayout().regions.left.itemIds).toEqual(["library"]);
});
