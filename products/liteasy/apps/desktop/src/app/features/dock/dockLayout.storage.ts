import { createDefaultDockLayout, moveDockItem, normalizeDockLayout } from "./dockLayout";
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

/** Upgrade the old default placement once; explicit split or populated bottom layouts stay intact. */
export function hasLegacyAssistantPlacementPreference(): boolean {
  const raw = window.localStorage.getItem(storageKey) ?? window.localStorage.getItem(legacyStorageKey);
  if (!raw) return true;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.readingLayoutVersion === 1) return false;
    const layout = normalizeDockLayout(parsed);
    return layout.regions.right.itemIds.length === 1 &&
      layout.regions.right.itemIds[0] === "assistant" &&
      layout.regions.bottom.itemIds.length === 0 &&
      layout.horizontalOrder.join() === "left,main,right" &&
      layout.bottomOrder.join() === "bottom" &&
      Object.keys(layout.regionWidths).length === 0;
  } catch {
    return false;
  }
}

export function loadDockLayout(): DockLayout {
  const rawValue = window.localStorage.getItem(storageKey) ?? window.localStorage.getItem(legacyStorageKey);
  if (!rawValue) {
    return createDefaultDockLayout();
  }

  try {
    const layout = normalizeDockLayout(JSON.parse(rawValue));
    const next = hasLegacyAssistantPlacementPreference() ? moveDockItem(layout, "assistant", "bottom") : layout;
    try {
      saveDockLayout(next);
    } catch {
      // Keep the loaded layout usable if storage is unavailable.
    }
    return next;
  } catch {
    return createDefaultDockLayout();
  }
}

export function saveDockLayout(layout: DockLayout) {
  // Preserve the legacy record for older applications; their writes cannot erase extension pages.
  window.localStorage.setItem(storageKey, JSON.stringify({ ...layout, version: 3, readingLayoutVersion: 1 }));
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
