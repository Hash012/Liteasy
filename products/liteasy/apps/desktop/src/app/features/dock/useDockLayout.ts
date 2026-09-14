import { useRef, useState } from "react";
import {
  activateDockItem,
  closeDockItem,
  findDockItemRegion,
  moveDockItem,
  openDockItem,
  splitDockRegion,
  removeDockRegion,
} from "./dockLayout";
import {
  loadDockLayout,
  loadDynamicDockPlacements,
  saveDockLayout,
  saveDynamicDockPlacements,
} from "./dockLayout.storage";
import type { DockItemId, DockLayout, DockRegionId } from "./dock.types";

export function useDockLayout() {
  const [layout, setLayoutState] = useState<DockLayout>(loadDockLayout);
  const layoutRef = useRef(layout);
  const [dynamicItemRegions, setDynamicItemRegions] = useState(
    loadDynamicDockPlacements,
  );
  const dynamicItemRegionsRef = useRef(dynamicItemRegions);

  function updateLayout(updater: (current: DockLayout) => DockLayout) {
    const current = layoutRef.current;
    const next = updater(current);
    if (next !== current) {
      layoutRef.current = next;
      saveDockLayout(next);
      setLayoutState(next);
    }
  }

  return {
    activateItem(regionId: DockRegionId, itemId: DockItemId) {
      updateLayout((current) => activateDockItem(current, regionId, itemId));
    },
    closeItem(itemId: DockItemId) {
      updateLayout((current) => closeDockItem(current, itemId));
    },
    findItemRegion(itemId: DockItemId) {
      return findDockItemRegion(layoutRef.current, itemId);
    },
    findDynamicItemRegion(itemId: string) {
      const region = dynamicItemRegionsRef.current[itemId];
      return region && layoutRef.current.regions[region] ? region : null;
    },
    dynamicItemRegions,
    layout,
    moveItem(itemId: DockItemId, targetRegionId: DockRegionId) {
      updateLayout((current) => moveDockItem(current, itemId, targetRegionId));
    },
    moveDynamicItem(itemId: string, targetRegionId: DockRegionId) {
      const next = {
        ...dynamicItemRegionsRef.current,
        [itemId]: targetRegionId,
      };
      dynamicItemRegionsRef.current = next;
      saveDynamicDockPlacements(next);
      setDynamicItemRegions(next);
    },
    splitRegion(
      anchor: DockRegionId,
      side: "left" | "right",
      id: DockRegionId = `bar-${crypto.randomUUID()}`,
    ) {
      updateLayout((current) => splitDockRegion(current, anchor, side, id));
      return id;
    },
    removeRegion(id: DockRegionId) {
      updateLayout((current) => removeDockRegion(current, id));
      const next = Object.fromEntries(
        Object.entries(dynamicItemRegionsRef.current).map(([key, region]) => [
          key,
          region === id ? "main" : region,
        ]),
      ) as typeof dynamicItemRegions;
      dynamicItemRegionsRef.current = next;
      saveDynamicDockPlacements(next);
      setDynamicItemRegions(next);
    },
    resizeRegion(id: DockRegionId, width: number) {
      updateLayout((current) => ({
        ...current,
        regionWidths: {
          ...current.regionWidths,
          [id]: Math.max(8, Math.min(160, width)),
        },
      }));
    },
    openItem(itemId: DockItemId) {
      updateLayout((current) => openDockItem(current, itemId));
    },
  };
}
