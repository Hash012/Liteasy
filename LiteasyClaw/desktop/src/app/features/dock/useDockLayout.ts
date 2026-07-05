import { useRef, useState } from "react";
import {
  activateDockItem,
  closeDockItem,
  findDockItemRegion,
  moveDockItem,
  openDockItem
} from "./dockLayout";
import { loadDockLayout, saveDockLayout } from "./dockLayout.storage";
import type { DockItemId, DockLayout, DockRegionId } from "./dock.types";

export function useDockLayout() {
  const [layout, setLayoutState] = useState<DockLayout>(loadDockLayout);
  const layoutRef = useRef(layout);

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
    layout,
    moveItem(itemId: DockItemId, targetRegionId: DockRegionId) {
      updateLayout((current) => moveDockItem(current, itemId, targetRegionId));
    },
    openItem(itemId: DockItemId) {
      updateLayout((current) => openDockItem(current, itemId));
    }
  };
}
