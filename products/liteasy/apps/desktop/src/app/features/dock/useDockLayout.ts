import { useRef, useState } from "react";
import {
  activateDockItem,
  closeDockItem,
  findDockItemRegion,
  moveDockItem,
  openDockItem
} from "./dockLayout";
import {
  loadDockLayout,
  loadDynamicDockPlacements,
  saveDockLayout,
  saveDynamicDockPlacements
} from "./dockLayout.storage";
import type { DockItemId, DockLayout, DockRegionId } from "./dock.types";

export function useDockLayout() {
  const [layout, setLayoutState] = useState<DockLayout>(loadDockLayout);
  const layoutRef = useRef(layout);
  const [dynamicItemRegions, setDynamicItemRegions] = useState(loadDynamicDockPlacements);
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
      return dynamicItemRegionsRef.current[itemId] ?? null;
    },
    dynamicItemRegions,
    layout,
    moveItem(itemId: DockItemId, targetRegionId: DockRegionId) {
      updateLayout((current) => moveDockItem(current, itemId, targetRegionId));
    },
    moveDynamicItem(itemId: string, targetRegionId: DockRegionId) {
      const next = {
        ...dynamicItemRegionsRef.current,
        [itemId]: targetRegionId
      };
      dynamicItemRegionsRef.current = next;
      saveDynamicDockPlacements(next);
      setDynamicItemRegions(next);
    },
    openItem(itemId: DockItemId) {
      updateLayout((current) => openDockItem(current, itemId));
    }
  };
}
