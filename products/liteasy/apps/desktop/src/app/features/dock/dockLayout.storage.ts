import { createDefaultDockLayout, normalizeDockLayout } from "./dockLayout";
import { isDockRegionId } from "./dockRegistry";
import type { DockLayout, DockRegionId } from "./dock.types";

const legacyStorageKey = "liteasy.ui.dock-layout.v1";
const storageKey = "liteasy.ui.dock-layout.v3";
const dynamicPlacementStorageKey = "liteasy.ui.dynamic-dock-placement.v1";
const dockRegionIds = new Set<DockRegionId>([
  "bottom",
  "left",
  "main",
  "right",
]);

export type DynamicDockPlacements = Record<string, DockRegionId>;

export function loadDockLayout(): DockLayout {
  const rawValue = window.localStorage.getItem(storageKey) ?? window.localStorage.getItem(legacyStorageKey);
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
  // Preserve the legacy record for older applications; their writes cannot erase extension pages.
  window.localStorage.setItem(storageKey, JSON.stringify({ ...layout, version: 3 }));
}

export function clearDockLayout() {
  window.localStorage.removeItem(storageKey);
  window.localStorage.removeItem(legacyStorageKey);
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
          entry[0].length > 0 && isDockRegionId(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

export function saveDynamicDockPlacements(placements: DynamicDockPlacements) {
  window.localStorage.setItem(
    dynamicPlacementStorageKey,
    JSON.stringify(placements),
  );
}
