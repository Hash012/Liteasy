import { useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { dockItemRegistry, dockRegionLabels, isDockItemId } from "./dockRegistry";
import type { DockItemId, DockRegionId, DockRegionLayout } from "./dock.types";
import { DockEmptyState } from "./DockEmptyState";

export const dockItemMimeType = "application/x-liteasy-dock-item";

type DockRegionProps = {
  layout: DockRegionLayout;
  onActivateItem: (itemId: DockItemId) => void;
  onMoveItem: (itemId: DockItemId, targetRegionId: DockRegionId) => void;
  regionId: DockRegionId;
  regionActions?: ReactNode;
  renderItem: (itemId: DockItemId) => ReactNode;
};

function hasDockPayload(event: DragEvent<HTMLElement>) {
  const types = event.dataTransfer?.types;
  return types ? Array.from(types).includes(dockItemMimeType) : false;
}

function canAcceptDockPayload(
  event: DragEvent<HTMLElement>,
  regionId: DockRegionId
) {
  if (!hasDockPayload(event)) {
    return false;
  }

  const itemId = event.dataTransfer.getData(dockItemMimeType);
  return (
    itemId === "" ||
    (isDockItemId(itemId) && dockItemRegistry[itemId].allowedRegions.includes(regionId))
  );
}

export function DockRegion({
  layout,
  onActivateItem,
  onMoveItem,
  regionId,
  regionActions,
  renderItem
}: DockRegionProps) {
  const [dropActive, setDropActive] = useState(false);
  const regionLabel = dockRegionLabels[regionId];

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDropActive(false);
    const itemId = event.dataTransfer.getData(dockItemMimeType);
    if (!isDockItemId(itemId)) {
      return;
    }
    if (!dockItemRegistry[itemId].allowedRegions.includes(regionId)) {
      return;
    }
    onMoveItem(itemId, regionId);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, itemId: DockItemId) {
    if (event.altKey && event.shiftKey) {
      const targetByKey: Partial<Record<string, DockRegionId>> = {
        ArrowDown: "bottom",
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "main"
      };
      const targetRegionId = targetByKey[event.key];
      if (
        targetRegionId &&
        dockItemRegistry[itemId].allowedRegions.includes(targetRegionId)
      ) {
        event.preventDefault();
        onMoveItem(itemId, targetRegionId);
        return;
      }
    }

    const itemIndex = layout.itemIds.indexOf(itemId);
    if (itemIndex === -1 || layout.itemIds.length < 2) {
      return;
    }

    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (itemIndex + 1) % layout.itemIds.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (itemIndex - 1 + layout.itemIds.length) % layout.itemIds.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = layout.itemIds.length - 1;
    }

    if (nextIndex !== null) {
      event.preventDefault();
      onActivateItem(layout.itemIds[nextIndex]);
    }
  }

  return (
    <section
      aria-label={`${regionLabel} Dock 区域`}
      className={`dock-region dock-region-${regionId} ${dropActive ? "drop-active" : ""}`}
      data-region={regionId}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropActive(false);
        }
      }}
      onDragOver={(event) => {
        if (!canAcceptDockPayload(event, regionId)) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropActive(true);
      }}
      onDrop={handleDrop}
    >
      {layout.itemIds.length > 0 || regionActions ? (
        <div className="dock-region-tab-row">
          {layout.itemIds.length > 0 ? (
            <div aria-label={`${regionLabel}标签页`} className="dock-tab-strip" role="tablist">
              {layout.itemIds.map((itemId) => {
                const descriptor = dockItemRegistry[itemId];
                const active = layout.activeItemId === itemId;
                return (
                  <button
                    aria-selected={active}
                    className={`dock-tab ${active ? "active" : ""}`}
                    draggable={descriptor.allowedRegions.length > 1}
                    id={`dock-tab-${regionId}-${itemId}`}
                    key={itemId}
                    onClick={() => onActivateItem(itemId)}
                    onDragEnd={() => setDropActive(false)}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData(dockItemMimeType, itemId);
                    }}
                    onKeyDown={(event) => handleTabKeyDown(event, itemId)}
                    role="tab"
                    tabIndex={active ? 0 : -1}
                    title={
                      descriptor.allowedRegions.length > 1
                        ? `拖动“${descriptor.title}”到其他区域`
                        : descriptor.title
                    }
                    type="button"
                  >
                    {descriptor.title}
                  </button>
                );
              })}
            </div>
          ) : null}
          {regionActions ? <div className="dock-region-actions">{regionActions}</div> : null}
        </div>
      ) : null}

      <div className="dock-region-body">
        {layout.itemIds.length === 0 ? (
          <DockEmptyState />
        ) : (
          layout.itemIds.map((itemId) => {
            const active = layout.activeItemId === itemId;
            return (
              <div
                aria-labelledby={`dock-tab-${regionId}-${itemId}`}
                className="dock-item-host"
                hidden={!active}
                key={itemId}
                role="tabpanel"
              >
                {renderItem(itemId)}
              </div>
            );
          })
        )}
      </div>
      {dropActive ? <div aria-hidden="true" className="dock-drop-overlay" /> : null}
    </section>
  );
}
