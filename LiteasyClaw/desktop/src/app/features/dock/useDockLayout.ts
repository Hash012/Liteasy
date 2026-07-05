import { useState } from "react";
import {
  activateDockItem,
  findDockItemRegion,
  moveDockItem,
  openDockItem
} from "./dockLayout";
import { loadDockLayout, saveDockLayout } from "./dockLayout.storage";
import type { DockItemId, DockLayout, DockRegionId } from "./dock.types";

export function useDockLayout() {
  const [layout, setLayoutState] = useState<DockLayout>(loadDockLayout);

  function updateLayout(updater: (current: DockLayout) => DockLayout) {
    setLayoutState((current) => {
      const next = updater(current);
      if (next !== current) {
        saveDockLayout(next);
      }
      return next;
    });
  }

  return {
    activateItem(regionId: DockRegionId, itemId: DockItemId) {
      updateLayout((current) => activateDockItem(current, regionId, itemId));
    },
    findItemRegion(itemId: DockItemId) {
      return findDockItemRegion(layout, itemId);
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
