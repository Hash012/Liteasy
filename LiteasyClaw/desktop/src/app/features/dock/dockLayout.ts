import { dockItemRegistry, isDockItemId } from "./dockRegistry";
import type {
  DockItemId,
  DockLayout,
  DockRegionId,
  DockRegionLayout
} from "./dock.types";

const regionOrder: DockRegionId[] = ["left", "main", "right", "bottom"];

function createRegion(itemIds: DockItemId[], activeItemId?: DockItemId): DockRegionLayout {
  return {
    activeItemId: activeItemId ?? itemIds[0] ?? null,
    itemIds
  };
}

export function createDefaultDockLayout(): DockLayout {
  return {
    regions: {
      bottom: createRegion(["artifacts"]),
      left: createRegion(["library"]),
      main: createRegion(["reader"]),
      right: createRegion(["assistant"])
    },
    version: 1
  };
}

function normalizeRegion(
  regionId: DockRegionId,
  value: unknown,
  claimedItems: Set<DockItemId>
): DockRegionLayout {
  if (!value || typeof value !== "object") {
    return createRegion([]);
  }

  const rawItemIds = "itemIds" in value && Array.isArray(value.itemIds) ? value.itemIds : [];
  const itemIds = rawItemIds.filter((itemId): itemId is DockItemId => {
    if (!isDockItemId(itemId) || claimedItems.has(itemId)) {
      return false;
    }
    if (!dockItemRegistry[itemId].allowedRegions.includes(regionId)) {
      return false;
    }
    claimedItems.add(itemId);
    return true;
  });
  const rawActiveItemId = "activeItemId" in value ? value.activeItemId : null;
  const activeItemId =
    isDockItemId(rawActiveItemId) && itemIds.includes(rawActiveItemId)
      ? rawActiveItemId
      : itemIds[0] ?? null;

  return {
    activeItemId,
    itemIds
  };
}

export function normalizeDockLayout(value: unknown): DockLayout {
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("regions" in value) ||
    !value.regions
  ) {
    return createDefaultDockLayout();
  }

  const claimedItems = new Set<DockItemId>();
  const rawRegions = value.regions as Record<string, unknown>;
  const regions = Object.fromEntries(
    regionOrder.map((regionId) => [
      regionId,
      normalizeRegion(regionId, rawRegions[regionId], claimedItems)
    ])
  ) as Record<DockRegionId, DockRegionLayout>;

  if (!claimedItems.has("reader")) {
    regions.main.itemIds.unshift("reader");
    regions.main.activeItemId ??= "reader";
  }

  return {
    regions,
    version: 1
  };
}

export function findDockItemRegion(layout: DockLayout, itemId: DockItemId) {
  return regionOrder.find((regionId) => layout.regions[regionId].itemIds.includes(itemId)) ?? null;
}

function removeItem(region: DockRegionLayout, itemId: DockItemId): DockRegionLayout {
  const itemIndex = region.itemIds.indexOf(itemId);
  if (itemIndex === -1) {
    return region;
  }

  const itemIds = region.itemIds.filter((currentItemId) => currentItemId !== itemId);
  const fallbackIndex = Math.min(itemIndex, itemIds.length - 1);
  return {
    activeItemId:
      region.activeItemId === itemId
        ? itemIds[fallbackIndex] ?? null
        : region.activeItemId,
    itemIds
  };
}

export function activateDockItem(
  layout: DockLayout,
  regionId: DockRegionId,
  itemId: DockItemId
): DockLayout {
  if (!layout.regions[regionId].itemIds.includes(itemId)) {
    return layout;
  }

  return {
    ...layout,
    regions: {
      ...layout.regions,
      [regionId]: {
        ...layout.regions[regionId],
        activeItemId: itemId
      }
    }
  };
}

export function moveDockItem(
  layout: DockLayout,
  itemId: DockItemId,
  targetRegionId: DockRegionId
): DockLayout {
  if (!dockItemRegistry[itemId].allowedRegions.includes(targetRegionId)) {
    return layout;
  }

  const sourceRegionId = findDockItemRegion(layout, itemId);
  const nextRegions = { ...layout.regions };
  if (sourceRegionId) {
    nextRegions[sourceRegionId] = removeItem(layout.regions[sourceRegionId], itemId);
  }

  const targetRegion = nextRegions[targetRegionId];
  nextRegions[targetRegionId] = {
    activeItemId: itemId,
    itemIds: [...targetRegion.itemIds.filter((currentId) => currentId !== itemId), itemId]
  };

  return {
    ...layout,
    regions: nextRegions
  };
}

export function openDockItem(layout: DockLayout, itemId: DockItemId): DockLayout {
  const currentRegionId = findDockItemRegion(layout, itemId);
  if (currentRegionId) {
    return activateDockItem(layout, currentRegionId, itemId);
  }

  return moveDockItem(layout, itemId, dockItemRegistry[itemId].preferredRegion);
}
