import {
  Button,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  Tooltip,
} from "@fluentui/react-components";
import {
  BookRegular,
  MoreHorizontalRegular,
  NoteRegular,
  WhiteboardRegular,
  FolderOpenRegular,
  DismissRegular,
  PanelLeftAddRegular,
  PanelRightAddRegular,
  ChatRegular,
  QuestionCircleRegular,
  PeopleRegular,
  PersonRegular,
  SettingsRegular,
  SparkleRegular,
} from "@fluentui/react-icons";
import {
  useState,
  useEffect,
  useRef,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  dockItemRegistry,
  dockRegionLabel,
  isDockItemId,
  canDockItemMoveTo,
} from "./dockRegistry";
import type { DockItemId, DockRegionId, DockRegionLayout } from "./dock.types";
import { DockEmptyState } from "./DockEmptyState";

export const dockItemMimeType = "application/x-liteasy-dock-item";
export const dockDynamicTabMimeType = "application/x-liteasy-dynamic-tab";

function getDockItemIcon(itemId: DockItemId) {
  switch (itemId) {
    case "board":
      return <WhiteboardRegular />;
    case "notes":
      return <NoteRegular />;
    case "artifact-library":
      return <FolderOpenRegular />;
    case "library":
      return <BookRegular />;
    case "organization":
      return <PeopleRegular />;
    case "profile":
      return <PersonRegular />;
    case "settings":
      return <SettingsRegular />;
    case "assistant":
      return <ChatRegular />;
    case "help":
      return <QuestionCircleRegular />;
    case "artifacts":
      return <SparkleRegular />;
  }
}

type DockRegionProps = {
  dynamicTabs?: Array<{
    draggable?: boolean;
    icon?: ReactNode;
    kind?: "document" | "artifact";
    id: string;
    onActivate: () => void;
    onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
    onClose?: () => void;
    render: () => ReactNode;
    selected: boolean;
    title: string;
  }>;
  layout: DockRegionLayout;
  onActivateItem: (itemId: DockItemId) => void;
  onCloseItem: (itemId: DockItemId) => void;
  onCloseRegion?: () => void;
  onSplitRegion?: (side: "left" | "right") => void;
  onItemDragStart?: (
    itemId: DockItemId,
    event: DragEvent<HTMLButtonElement>,
  ) => void;
  onMoveDynamicTab?: (tabId: string, targetRegionId: DockRegionId) => void;
  onMoveItem: (itemId: DockItemId, targetRegionId: DockRegionId) => void;
  overlay?: ReactNode;
  regionId: DockRegionId;
  regionActions?: ReactNode;
  renderItem: (itemId: DockItemId, regionId: DockRegionId) => ReactNode;
};

function hasDockPayload(event: DragEvent<HTMLElement>) {
  const types = event.dataTransfer?.types;
  return types
    ? Array.from(types).some(
        (type) => type === dockItemMimeType || type === dockDynamicTabMimeType,
      )
    : false;
}

function canAcceptDockPayload(
  event: DragEvent<HTMLElement>,
  regionId: DockRegionId,
  onMoveDynamicTab?: (tabId: string, targetRegionId: DockRegionId) => void,
) {
  if (!hasDockPayload(event)) {
    return false;
  }

  const dynamicTabId = event.dataTransfer.getData(dockDynamicTabMimeType);
  if (
    Array.from(event.dataTransfer.types).includes(dockDynamicTabMimeType) &&
    onMoveDynamicTab
  ) {
    return dynamicTabId === "" || dynamicTabId.length > 0;
  }

  const itemId = event.dataTransfer.getData(dockItemMimeType);
  return (
    itemId === "" ||
    (isDockItemId(itemId) && canDockItemMoveTo(itemId, regionId))
  );
}

export function DockRegion({
  dynamicTabs = [],
  layout,
  onActivateItem,
  onCloseItem,
  onCloseRegion,
  onSplitRegion,
  onItemDragStart,
  onMoveDynamicTab,
  onMoveItem,
  overlay,
  regionId,
  regionActions,
  renderItem,
}: DockRegionProps) {
  const [dropActive, setDropActive] = useState(false);
  const regionElement = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = regionElement.current;
    if (!element) return;
    // Persistent portals retain their React parent. Handle plain tab drags through
    // their DOM container; resource payloads remain owned by the surface itself.
    const isPortalTabDrag = (event: globalThis.DragEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".dock-persistent-surface") ||
        !event.dataTransfer
      )
        return false;
      const types = Array.from(event.dataTransfer.types);
      return (
        types.some(
          (type) =>
            type === dockItemMimeType || type === dockDynamicTabMimeType,
        ) &&
        types.every(
          (type) =>
            type === dockItemMimeType ||
            type === dockDynamicTabMimeType ||
            type === "text/plain",
        )
      );
    };
    const dragOver = (event: globalThis.DragEvent) => {
      if (!isPortalTabDrag(event)) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = "move";
      setDropActive(true);
    };
    const drop = (event: globalThis.DragEvent) => {
      if (!isPortalTabDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setDropActive(false);
      const tabId = event.dataTransfer!.getData(dockDynamicTabMimeType);
      if (tabId && onMoveDynamicTab) {
        onMoveDynamicTab(tabId, regionId);
        return;
      }
      const item = event.dataTransfer!.getData(dockItemMimeType);
      if (isDockItemId(item) && canDockItemMoveTo(item, regionId))
        onMoveItem(item, regionId);
    };
    element.addEventListener("dragover", dragOver);
    element.addEventListener("drop", drop);
    return () => {
      element.removeEventListener("dragover", dragOver);
      element.removeEventListener("drop", drop);
    };
  }, [regionId, onMoveItem, onMoveDynamicTab]);

  const regionLabel = dockRegionLabel(regionId);
  const activeDynamicTab = dynamicTabs.find((tab) => tab.selected);
  const hasTabs = layout.itemIds.length > 0 || dynamicTabs.length > 0;

  function handleDrop(event: DragEvent<HTMLElement>) {
    if (!hasDockPayload(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
    const dynamicTabId = event.dataTransfer.getData(dockDynamicTabMimeType);
    if (dynamicTabId && onMoveDynamicTab) {
      onMoveDynamicTab(dynamicTabId, regionId);
      return;
    }

    const itemId = event.dataTransfer.getData(dockItemMimeType);
    if (!isDockItemId(itemId)) {
      return;
    }
    if (!canDockItemMoveTo(itemId, regionId)) {
      return;
    }
    onMoveItem(itemId, regionId);
  }

  function handleDynamicTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    tabId: string,
  ) {
    if (!event.altKey || !event.shiftKey || !onMoveDynamicTab) {
      return;
    }
    const targetByKey: Partial<Record<string, DockRegionId>> = {
      ArrowDown: "bottom",
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "main",
    };
    const targetRegionId = targetByKey[event.key];
    if (!targetRegionId) {
      return;
    }
    event.preventDefault();
    onMoveDynamicTab(tabId, targetRegionId);
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    itemId: DockItemId,
  ) {
    if (event.altKey && event.shiftKey) {
      const targetByKey: Partial<Record<string, DockRegionId>> = {
        ArrowDown: "bottom",
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "main",
      };
      const targetRegionId = targetByKey[event.key];
      if (targetRegionId && canDockItemMoveTo(itemId, targetRegionId)) {
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
      nextIndex =
        (itemIndex - 1 + layout.itemIds.length) % layout.itemIds.length;
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
      ref={regionElement}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropActive(false);
        }
      }}
      onDragOver={(event) => {
        if (!canAcceptDockPayload(event, regionId, onMoveDynamicTab)) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropActive(true);
      }}
      onDrop={handleDrop}
    >
      {hasTabs || regionActions || onSplitRegion || onCloseRegion ? (
        <div className="dock-region-tab-row">
          {hasTabs ? (
            <div
              aria-label={`${regionLabel}标签页`}
              className="dock-tab-strip"
              role="tablist"
            >
              {layout.itemIds.map((itemId) => {
                const descriptor = dockItemRegistry[itemId];
                const active =
                  !activeDynamicTab && layout.activeItemId === itemId;
                const tooltipContent =
                  descriptor.allowedRegions.length > 1
                    ? `${descriptor.title} · 可拖动到其他区域`
                    : descriptor.title;
                return (
                  <div className="dock-dynamic-tab" key={itemId}>
                    <Tooltip
                      content={tooltipContent}
                      positioning="below"
                      relationship="description"
                    >
                      <button
                        aria-label={descriptor.title}
                        aria-selected={active}
                        className={`dock-tab dock-tab-icon-only ${active ? "active" : ""}`}
                        draggable={descriptor.allowedRegions.length > 1}
                        id={`dock-tab-${regionId}-${itemId}`}
                        onClick={() => onActivateItem(itemId)}
                        onDragEnd={() => setDropActive(false)}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData(dockItemMimeType, itemId);
                          onItemDragStart?.(itemId, event);
                        }}
                        onKeyDown={(event) => handleTabKeyDown(event, itemId)}
                        role="tab"
                        tabIndex={active ? 0 : -1}
                        type="button"
                      >
                        <span aria-hidden="true" className="dock-tab-icon">
                          {getDockItemIcon(itemId)}
                        </span>
                      </button>
                    </Tooltip>
                    <button
                      aria-label={`关闭 ${descriptor.title}`}
                      className="dock-tab-close"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCloseItem(itemId);
                      }}
                      title={`关闭 ${descriptor.title}`}
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              {dynamicTabs.map((tab) => (
                <div className="dock-dynamic-tab" key={tab.id}>
                  <button
                    aria-selected={tab.selected}
                    className={`dock-tab ${tab.kind === "document" ? "dock-document-tab" : ""} ${tab.selected ? "active" : ""}`}
                    draggable={tab.draggable && Boolean(onMoveDynamicTab)}
                    id={`dock-tab-${regionId}-${tab.id}`}
                    onClick={tab.onActivate}
                    onDragEnd={() => setDropActive(false)}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData(
                        dockDynamicTabMimeType,
                        tab.id,
                      );
                      tab.onDragStart?.(event);
                    }}
                    onKeyDown={(event) =>
                      handleDynamicTabKeyDown(event, tab.id)
                    }
                    role="tab"
                    tabIndex={tab.selected ? 0 : -1}
                    title={
                      tab.draggable
                        ? `拖动“${tab.title}”到其他区域；Alt+Shift+方向键也可移动`
                        : tab.title
                    }
                    type="button"
                  >
                    {tab.icon ? (
                      <span aria-hidden="true" className="dock-tab-icon">
                        {tab.icon}
                      </span>
                    ) : null}
                    <span className="dock-tab-title">{tab.title}</span>
                  </button>
                  {tab.onClose ? (
                    <button
                      aria-label={`关闭 ${tab.title}`}
                      className="dock-tab-close"
                      onClick={(event) => {
                        event.stopPropagation();
                        tab.onClose?.();
                      }}
                      title={`关闭 ${tab.title}`}
                      type="button"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          <div className="dock-region-actions">
            {regionActions}
            {onSplitRegion || onCloseRegion ? (
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Tooltip content="面板选项" relationship="description">
                    <Button
                      appearance="subtle"
                      aria-label={`${regionLabel}面板选项`}
                      icon={<MoreHorizontalRegular />}
                    />
                  </Tooltip>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    {onSplitRegion ? (
                      <>
                        <MenuItem
                          icon={<PanelLeftAddRegular />}
                          onClick={() => onSplitRegion("left")}
                        >
                          在左边新建栏
                        </MenuItem>
                        <MenuItem
                          icon={<PanelRightAddRegular />}
                          onClick={() => onSplitRegion("right")}
                        >
                          在右边新建栏
                        </MenuItem>
                      </>
                    ) : null}
                    {onCloseRegion ? (
                      <MenuItem
                        icon={<DismissRegular />}
                        onClick={onCloseRegion}
                      >
                        关闭面板
                      </MenuItem>
                    ) : null}
                  </MenuList>
                </MenuPopover>
              </Menu>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="dock-region-body">
        {layout.itemIds.length === 0 && dynamicTabs.length === 0 ? (
          <DockEmptyState />
        ) : (
          <>
            {layout.itemIds.map((itemId) => {
              const active =
                !activeDynamicTab && layout.activeItemId === itemId;
              return (
                <div
                  aria-labelledby={`dock-tab-${regionId}-${itemId}`}
                  className="dock-item-host"
                  hidden={!active}
                  key={itemId}
                  role="tabpanel"
                >
                  {renderItem(itemId, regionId)}
                </div>
              );
            })}
            {dynamicTabs.map((tab) => (
              <div
                aria-labelledby={`dock-tab-${regionId}-${tab.id}`}
                className="dock-item-host"
                hidden={!tab.selected}
                key={tab.id}
                role="tabpanel"
              >
                {tab.kind === "document" && !tab.selected ? null : tab.render()}
              </div>
            ))}
          </>
        )}
      </div>
      {overlay ? <div className="dock-region-overlay">{overlay}</div> : null}
      {dropActive ? (
        <div aria-hidden="true" className="dock-drop-overlay" />
      ) : null}
    </section>
  );
}
