import {
  dockItemRegistry,
  isDockItemId,
  isDockRegionId,
  canDockItemMoveTo,
} from "./dockRegistry";
import type {
  DockItemId,
  DockLayout,
  DockRegionId,
  DockRegionLayout,
} from "./dock.types";

const regionOrder: DockRegionId[] = ["left", "main", "right", "bottom"];

function createRegion(
  itemIds: DockItemId[],
  activeItemId?: DockItemId,
): DockRegionLayout {
  return {
    activeItemId: activeItemId ?? itemIds[0] ?? null,
    itemIds,
  };
}

export function createDefaultDockLayout(): DockLayout {
  return {
    regions: {
      bottom: createRegion([]),
      left: createRegion(["library"]),
      main: createRegion([]),
      right: createRegion(["assistant"]),
    },
    horizontalOrder: ["left", "main", "right"],
    bottomOrder: ["bottom"],
    regionWidths: {},
    version: 2,
  };
}

function normalizeRegion(
  regionId: DockRegionId,
  value: unknown,
  claimedItems: Set<DockItemId>,
  legacy = false,
): DockRegionLayout {
  if (!value || typeof value !== "object") {
    return createRegion([]);
  }

  const rawItemIds =
    "itemIds" in value && Array.isArray(value.itemIds) ? value.itemIds : [];
  const regionItems = new Set<DockItemId>();
  const candidateItemIds = rawItemIds.filter((itemId): itemId is DockItemId => {
    if (
      !isDockItemId(itemId) ||
      claimedItems.has(itemId) ||
      regionItems.has(itemId)
    ) {
      return false;
    }
    if (itemId === "artifacts") {
      return false;
    }
    if (!canDockItemMoveTo(itemId, regionId)) {
      return false;
    }
    regionItems.add(itemId);
    return true;
  });
  const rawActiveItemId = "activeItemId" in value ? value.activeItemId : null;
  const activeItemId =
    isDockItemId(rawActiveItemId) && candidateItemIds.includes(rawActiveItemId)
      ? rawActiveItemId
      : (candidateItemIds[0] ?? null);
  const itemIds =
    legacy && regionId === "left" && activeItemId
      ? [activeItemId]
      : candidateItemIds;
  itemIds.forEach((itemId) => claimedItems.add(itemId));

  return {
    activeItemId,
    itemIds,
  };
}

export function normalizeDockLayout(value: unknown): DockLayout {
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    (value.version !== 1 && value.version !== 2) ||
    !("regions" in value) ||
    !value.regions
  ) {
    return createDefaultDockLayout();
  }

  const claimedItems = new Set<DockItemId>();
  const rawRegions = value.regions as Record<string, unknown>;
  const extras = Object.keys(rawRegions).filter(
    (id): id is DockRegionId => isDockRegionId(id) && !regionOrder.includes(id),
  );
  const order = [...regionOrder, ...extras];
  const regions = Object.fromEntries(
    order.map((regionId) => [
      regionId,
      normalizeRegion(
        regionId,
        rawRegions[regionId],
        claimedItems,
        value.version === 1,
      ),
    ]),
  ) as Record<DockRegionId, DockRegionLayout>;

  const rawOrder =
    "horizontalOrder" in value && Array.isArray(value.horizontalOrder)
      ? value.horizontalOrder
      : [];
  const rawBottomOrder =
    "bottomOrder" in value && Array.isArray(value.bottomOrder)
      ? value.bottomOrder
      : [];
  const bottomOrder = [...new Set([...rawBottomOrder, "bottom"])].filter(
    (id): id is DockRegionId =>
      isDockRegionId(id) &&
      (id === "bottom" || id.startsWith("bar-")) &&
      Boolean(regions[id]),
  );
  const horizontalOrder = [
    ...new Set([...rawOrder, "left", "main", "right", ...extras]),
  ].filter(
    (id): id is DockRegionId =>
      isDockRegionId(id) && !bottomOrder.includes(id) && Boolean(regions[id]),
  );
  const widths =
    "regionWidths" in value &&
    value.regionWidths &&
    typeof value.regionWidths === "object"
      ? value.regionWidths
      : {};
  const regionWidths = Object.fromEntries(
    Object.entries(widths).filter(
      ([id, width]) =>
        isDockRegionId(id) &&
        regions[id] &&
        typeof width === "number" &&
        Number.isFinite(width) &&
        width >= 8 &&
        width <= 160,
    ),
  );
  return { regions, horizontalOrder, bottomOrder, regionWidths, version: 2 };
}

export function findDockItemRegion(layout: DockLayout, itemId: DockItemId) {
  return (
    (Object.keys(layout.regions).find((regionId) =>
      layout.regions[regionId as DockRegionId].itemIds.includes(itemId),
    ) as DockRegionId | undefined) ?? null
  );
}

function removeItem(
  region: DockRegionLayout,
  itemId: DockItemId,
): DockRegionLayout {
  const itemIndex = region.itemIds.indexOf(itemId);
  if (itemIndex === -1) {
    return region;
  }

  const itemIds = region.itemIds.filter(
    (currentItemId) => currentItemId !== itemId,
  );
  const fallbackIndex = Math.min(itemIndex, itemIds.length - 1);
  return {
    activeItemId:
      region.activeItemId === itemId
        ? (itemIds[fallbackIndex] ?? null)
        : region.activeItemId,
    itemIds,
  };
}

export function activateDockItem(
  layout: DockLayout,
  regionId: DockRegionId,
  itemId: DockItemId,
): DockLayout {
  if (!layout.regions[regionId]?.itemIds.includes(itemId)) {
    return layout;
  }

  return {
    ...layout,
    regions: {
      ...layout.regions,
      [regionId]: {
        ...layout.regions[regionId],
        activeItemId: itemId,
      },
    },
  };
}

export function closeDockItem(
  layout: DockLayout,
  itemId: DockItemId,
): DockLayout {
  const regionId = findDockItemRegion(layout, itemId);
  if (!regionId) {
    return layout;
  }

  return {
    ...layout,
    regions: {
      ...layout.regions,
      [regionId]: removeItem(layout.regions[regionId], itemId),
    },
  };
}

export function moveDockItem(
  layout: DockLayout,
  itemId: DockItemId,
  targetRegionId: DockRegionId,
): DockLayout {
  if (
    !layout.regions[targetRegionId] ||
    !canDockItemMoveTo(itemId, targetRegionId)
  ) {
    return layout;
  }

  const sourceRegionId = findDockItemRegion(layout, itemId);
  const nextRegions = { ...layout.regions };
  if (sourceRegionId) {
    nextRegions[sourceRegionId] = removeItem(
      layout.regions[sourceRegionId],
      itemId,
    );
  }

  const targetRegion = nextRegions[targetRegionId];
  nextRegions[targetRegionId] = {
    activeItemId: itemId,
    itemIds: [
      ...targetRegion.itemIds.filter((currentId) => currentId !== itemId),
      itemId,
    ],
  };

  return {
    ...layout,
    regions: nextRegions,
  };
}

export function openDockItem(
  layout: DockLayout,
  itemId: DockItemId,
): DockLayout {
  const currentRegionId = findDockItemRegion(layout, itemId);
  if (currentRegionId) {
    return activateDockItem(layout, currentRegionId, itemId);
  }

  return moveDockItem(layout, itemId, dockItemRegistry[itemId].preferredRegion);
}

/** A split is an independently addressable tab container, persisted beside its anchor. */
export function splitDockRegion(
  layout: DockLayout,
  anchor: DockRegionId,
  side: "left" | "right",
  id: DockRegionId,
): DockLayout {
  if (
    !isDockRegionId(id) ||
    !id.startsWith("bar-") ||
    layout.regions[id] ||
    !layout.regions[anchor]
  )
    return layout;
  const bottom = layout.bottomOrder.includes(anchor);
  const order = [...(bottom ? layout.bottomOrder : layout.horizontalOrder)];
  order.splice(order.indexOf(anchor) + (side === "right" ? 1 : 0), 0, id);
  return {
    ...layout,
    ...(bottom ? { bottomOrder: order } : { horizontalOrder: order }),
    regions: { ...layout.regions, [id]: createRegion([]) },
  };
}

export function removeDockRegion(
  layout: DockLayout,
  id: DockRegionId,
): DockLayout {
  if (!id.startsWith("bar-") || !layout.regions[id]) return layout;
  let next = layout;
  for (const item of layout.regions[id].itemIds)
    next = moveDockItem(next, item, "main");
  const regions = { ...next.regions };
  const regionWidths = { ...next.regionWidths };
  delete regions[id];
  delete regionWidths[id];
  return {
    ...next,
    regions,
    regionWidths,
    horizontalOrder: next.horizontalOrder.filter((region) => region !== id),
    bottomOrder: next.bottomOrder.filter((region) => region !== id),
  };
}
