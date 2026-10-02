import { useState } from "react";
import type {
  DockBaseRegionId,
  DockItemId,
  DockRegionId,
} from "../features/dock/dock.types";
import {
  dockItemRegistry,
  isBaseDockRegionId,
} from "../features/dock/dockRegistry";
import type { useDockLayout } from "../features/dock/useDockLayout";

/** Reveal a registered tool regardless of closed tabs, collapsed panes or the board. */
export function useWorkbenchNavigationController(input: {
  dock: Pick<
    ReturnType<typeof useDockLayout>,
    "layout" | "findItemRegion" | "openItem" | "moveItem"
  >;
  collapsed: Record<Exclude<DockBaseRegionId, "main">, boolean>;
  setCollapsed(
    region: Exclude<DockBaseRegionId, "main">,
    collapsed: boolean,
  ): void;
  boardVisible: boolean;
  closeBoard(): void;
  activate(region: DockRegionId, item: DockItemId): void;
  activeDynamicItems: Partial<Record<DockRegionId, string | null>>;
}) {
  const [hiddenRegions, setHiddenRegions] = useState<DockRegionId[]>([]);
  function reveal(region: DockRegionId) {
    setHiddenRegions((current) => current.includes(region) ? current.filter((id) => id !== region) : current);
    if (input.dock.layout.bottomOrder.includes(region)) input.setCollapsed("bottom", false);
    else if (isBaseDockRegionId(region) && region !== "main") input.setCollapsed(region, false);
  }
  return {
    hiddenRegions,
    reveal,
    collapse(region: DockRegionId) {
      if (region === "left" || region === "right") input.setCollapsed(region, true);
      else if (region === "bottom" && input.dock.layout.bottomOrder.length === 1) input.setCollapsed("bottom", true);
      else {
        setHiddenRegions((current) => current.includes(region) ? current : [...current, region]);
        if (input.dock.layout.bottomOrder.includes(region) && input.dock.layout.bottomOrder.every((id) => id === region || hiddenRegions.includes(id)))
          input.setCollapsed("bottom", true);
      }
    },
    open(item: DockItemId) {
      if (item === "metadata-editor") {
        input.dock.moveItem(item, "right"); reveal("right"); input.activate("right", item); return;
      }
      // Settings is a workspace page, including for users with an old sidebar layout.
      if (item === "settings" || item === "recommendation-reader") {
        input.dock.moveItem(item, "main");
        reveal("main");
        input.activate("main", item);
        return;
      }
      const region =
        input.dock.findItemRegion(item) ??
        dockItemRegistry[item].preferredRegion;
      input.dock.openItem(item);
      reveal(region);
      input.activate(region, item);
    },
    isVisible(item: DockItemId) {
      const region = input.dock.findItemRegion(item);
      return Boolean(
        region &&
        !hiddenRegions.includes(region) &&
        input.dock.layout.regions[region].activeItemId === item &&
        !input.activeDynamicItems[region] &&
        (!input.dock.layout.bottomOrder.includes(region) ||
          !input.collapsed.bottom) &&
        (!isBaseDockRegionId(region) ||
          region === "main" ||
          !input.collapsed[region]),
      );
    },
  };
}
