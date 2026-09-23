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
    "layout" | "findItemRegion" | "openItem"
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
  return {
    open(item: "assistant" | "help" | "notes" | "board" | "reading-library") {
      const region =
        input.dock.findItemRegion(item) ??
        dockItemRegistry[item].preferredRegion;
      input.dock.openItem(item);
      input.activate(region, item);
      if (input.dock.layout.bottomOrder.includes(region))
        input.setCollapsed("bottom", false);
      else if (isBaseDockRegionId(region) && region !== "main")
        input.setCollapsed(region, false);
    },
    isVisible(item: DockItemId) {
      const region = input.dock.findItemRegion(item);
      return Boolean(
        region &&
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
