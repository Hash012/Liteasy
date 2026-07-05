import { describe, expect, test } from "vitest";
import {
  createDefaultDockLayout,
  findDockItemRegion,
  moveDockItem,
  normalizeDockLayout,
  openDockItem
} from "../app/features/dock/dockLayout";

describe("dock layout", () => {
  test("starts with the four product areas in their preferred regions", () => {
    const layout = createDefaultDockLayout();

    expect(layout.regions.left).toEqual({
      activeItemId: "library",
      itemIds: ["library"]
    });
    expect(layout.regions.main.itemIds).toEqual(["reader"]);
    expect(layout.regions.right.itemIds).toEqual(["assistant"]);
    expect(layout.regions.bottom.itemIds).toEqual(["artifacts"]);
  });

  test("moves a tab across allowed regions and leaves a real empty region", () => {
    const layout = moveDockItem(createDefaultDockLayout(), "assistant", "bottom");

    expect(layout.regions.right).toEqual({
      activeItemId: null,
      itemIds: []
    });
    expect(layout.regions.bottom).toEqual({
      activeItemId: "assistant",
      itemIds: ["artifacts", "assistant"]
    });
    expect(findDockItemRegion(layout, "assistant")).toBe("bottom");
  });

  test("rejects a drop outside an item's allowed regions", () => {
    const layout = createDefaultDockLayout();

    expect(moveDockItem(layout, "reader", "right")).toBe(layout);
  });

  test("opens a missing activity item in its preferred region", () => {
    const layout = openDockItem(createDefaultDockLayout(), "organization");

    expect(layout.regions.left.itemIds).toEqual(["library", "organization"]);
    expect(layout.regions.left.activeItemId).toBe("organization");
  });

  test("normalizes duplicate, unknown and invalid stored items while restoring Reader", () => {
    const layout = normalizeDockLayout({
      regions: {
        bottom: {
          activeItemId: "assistant",
          itemIds: ["unknown", "assistant", "library"]
        },
        left: {
          activeItemId: "reader",
          itemIds: ["reader", "library"]
        },
        main: {
          activeItemId: null,
          itemIds: []
        },
        right: {
          activeItemId: "assistant",
          itemIds: ["assistant"]
        }
      },
      version: 1
    });

    expect(layout.regions.left.itemIds).toEqual(["library"]);
    expect(layout.regions.bottom.itemIds).toEqual([]);
    expect(layout.regions.right.itemIds).toEqual(["assistant"]);
    expect(layout.regions.main.itemIds).toEqual(["reader"]);
  });

  test("falls back safely when a future layout schema is not understood", () => {
    const layout = normalizeDockLayout({
      regions: {
        bottom: { activeItemId: null, itemIds: [] },
        left: { activeItemId: null, itemIds: [] },
        main: { activeItemId: null, itemIds: [] },
        right: { activeItemId: null, itemIds: [] }
      },
      version: 99
    });

    expect(layout).toEqual(createDefaultDockLayout());
  });
});
