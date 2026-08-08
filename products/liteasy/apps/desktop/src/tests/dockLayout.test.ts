import { describe, expect, test } from "vitest";
import {
  createDefaultDockLayout,
  findDockItemRegion,
  closeDockItem,
  moveDockItem,
  normalizeDockLayout,
  openDockItem
} from "../app/features/dock/dockLayout";

describe("dock layout", () => {
  test("starts with the three persistent product areas and an empty document workspace", () => {
    const layout = createDefaultDockLayout();

    expect(layout.regions.left).toEqual({
      activeItemId: "library",
      itemIds: ["library"]
    });
    expect(layout.regions.main.itemIds).toEqual([]);
    expect(layout.regions.right.itemIds).toEqual(["assistant"]);
    expect(layout.regions.bottom.itemIds).toEqual([]);
  });

  test("moves a tab across allowed regions and leaves a real empty region", () => {
    const layout = moveDockItem(createDefaultDockLayout(), "assistant", "bottom");

    expect(layout.regions.right).toEqual({
      activeItemId: null,
      itemIds: []
    });
    expect(layout.regions.bottom).toEqual({
      activeItemId: "assistant",
      itemIds: ["assistant"]
    });
    expect(findDockItemRegion(layout, "assistant")).toBe("bottom");
  });

  test("rejects a drop outside an item's allowed regions", () => {
    const layout = createDefaultDockLayout();

    expect(moveDockItem(layout, "artifacts", "left")).toBe(layout);
  });

  test("opens a missing activity item in its preferred region", () => {
    const layout = openDockItem(createDefaultDockLayout(), "organization");

    expect(layout.regions.left.itemIds).toEqual(["organization"]);
    expect(layout.regions.left.activeItemId).toBe("organization");
  });

  test("keeps the left region to a single tab when a new item opens there", () => {
    const layout = moveDockItem(createDefaultDockLayout(), "assistant", "left");

    expect(layout.regions.left).toEqual({
      activeItemId: "assistant",
      itemIds: ["assistant"]
    });
    expect(findDockItemRegion(layout, "library")).toBeNull();
  });

  test("closes a dock item and activates the nearest remaining tab", () => {
    const layout = moveDockItem(createDefaultDockLayout(), "assistant", "bottom");
    const closed = closeDockItem(layout, "assistant");

    expect(closed.regions.bottom).toEqual({
      activeItemId: null,
      itemIds: []
    });
    expect(findDockItemRegion(closed, "assistant")).toBeNull();
  });

  test("normalizes duplicate, unknown and invalid stored items without restoring a legacy Reader", () => {
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
    expect(layout.regions.main.itemIds).toEqual([]);
  });

  test("migrates legacy standalone artifact dock items out of stored layouts", () => {
    const layout = normalizeDockLayout({
      regions: {
        bottom: {
          activeItemId: "artifacts",
          itemIds: ["artifacts"]
        },
        left: {
          activeItemId: "library",
          itemIds: ["library"]
        },
        main: {
          activeItemId: "reader",
          itemIds: ["reader"]
        },
        right: {
          activeItemId: "assistant",
          itemIds: ["assistant"]
        }
      },
      version: 1
    });

    expect(layout.regions.bottom).toEqual({
      activeItemId: null,
      itemIds: []
    });
    expect(layout.regions.main.itemIds).toEqual([]);
  });

  test("migrates legacy multi-tab left regions to the active tab", () => {
    const layout = normalizeDockLayout({
      regions: {
        bottom: {
          activeItemId: null,
          itemIds: []
        },
        left: {
          activeItemId: "organization",
          itemIds: ["library", "organization", "settings"]
        },
        main: {
          activeItemId: "reader",
          itemIds: ["reader"]
        },
        right: {
          activeItemId: "assistant",
          itemIds: ["assistant"]
        }
      },
      version: 1
    });

    expect(layout.regions.left).toEqual({
      activeItemId: "organization",
      itemIds: ["organization"]
    });
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
