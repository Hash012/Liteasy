import type { DockItemId, DockRegionId } from "../features/dock/dock.types";
import { dockItemRegistry } from "../features/dock/dockRegistry";
import type { useDockLayout } from "../features/dock/useDockLayout";

/** Reveal a registered tool regardless of closed tabs, collapsed panes or the board. */
export function useWorkbenchNavigationController(input: {
  dock: Pick<
    ReturnType<typeof useDockLayout>,
    "layout" | "findItemRegion" | "openItem"
  >;
  collapsed: Record<Exclude<DockRegionId, "main">, boolean>;
  setCollapsed(region: Exclude<DockRegionId, "main">, collapsed: boolean): void;
  boardVisible: boolean;
  closeBoard(): void;
  activate(region: DockRegionId, item: DockItemId): void;
  activeDynamicItems: Partial<Record<DockRegionId, string | null>>;
}) {
  return {
    open(item: "assistant" | "help") {
      const region =
        input.dock.findItemRegion(item) ??
        dockItemRegistry[item].preferredRegion;
      input.dock.openItem(item);
      input.activate(region, item);
      if (region !== "main") input.setCollapsed(region, false);
      if (region === "right") input.closeBoard();
    },
    isVisible(item: "assistant" | "help") {
      const region = input.dock.findItemRegion(item);
      return Boolean(
        region &&
        input.dock.layout.regions[region].activeItemId === item &&
        !input.activeDynamicItems[region] &&
        (region === "main" || !input.collapsed[region]) &&
        (region !== "right" || !input.boardVisible),
      );
    },
  };
}
