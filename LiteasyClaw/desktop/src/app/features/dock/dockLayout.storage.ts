import { createDefaultDockLayout, normalizeDockLayout } from "./dockLayout";
import type { DockLayout, DockRegionId } from "./dock.types";

const storageKey = "liteasy.ui.dock-layout.v1";
const dynamicPlacementStorageKey = "liteasy.ui.dynamic-dock-placement.v1";
const dockRegionIds = new Set<DockRegionId>(["bottom", "left", "main", "right"]);

export type DynamicDockPlacements = Record<string, DockRegionId>;

export function loadDockLayout(): DockLayout {
  const rawValue = window.localStorage.getItem(storageKey);
  if (!rawValue) {
    return createDefaultDockLayout();
  }

  try {
    return normalizeDockLayout(JSON.parse(rawValue));
  } catch {
    return createDefaultDockLayout();
  }
}

export function saveDockLayout(layout: DockLayout) {
  window.localStorage.setItem(storageKey, JSON.stringify(layout));
}

export function clearDockLayout() {
  window.localStorage.removeItem(storageKey);
  window.localStorage.removeItem(dynamicPlacementStorageKey);
}

export function loadDynamicDockPlacements(): DynamicDockPlacements {
  const rawValue = window.localStorage.getItem(dynamicPlacementStorageKey);
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, DockRegionId] =>
          entry[0].length > 0 && dockRegionIds.has(entry[1] as DockRegionId)
      )
    );
  } catch {
    return {};
  }
}

export function saveDynamicDockPlacements(placements: DynamicDockPlacements) {
  window.localStorage.setItem(dynamicPlacementStorageKey, JSON.stringify(placements));
}
