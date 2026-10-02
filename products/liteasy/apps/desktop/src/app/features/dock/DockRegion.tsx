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
  ChevronDownRegular,
  CheckmarkRegular,
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
  useLayoutEffect,
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
    case "paper-note":
    case "note-file-reader":
    case "notes":
      return <NoteRegular />;
    case "artifact-library":
      return <FolderOpenRegular />;
    case "library":
    case "document-reader":
    case "recommendation-reader":
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
    case "extension-library":
    case "workflow-studio":
      return <SparkleRegular />;
    default:
      return <WhiteboardRegular />;
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
  onCollapseRegion?: () => void;
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
  onCollapseRegion,
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
  const tabStrip = useRef<HTMLDivElement>(null);
  const [tabsOverflow, setTabsOverflow] = useState(false);
  const tabSignature = JSON.stringify([layout.itemIds, dynamicTabs.map(({ id, title }) => [id, title])]);
  const selectedTabId = dynamicTabs.find((tab) => tab.selected)?.id ?? layout.activeItemId;
  function measureOverflow() {
    const strip = tabStrip.current;
    setTabsOverflow(!!strip && strip.scrollWidth > strip.clientWidth + 1);
  }
  function revealTab(tab: HTMLElement | null) {
    const strip = tabStrip.current;
    if (!strip || !tab) return;
    const bounds = strip.getBoundingClientRect();
    const item = (tab.closest(".dock-dynamic-tab") ?? tab).getBoundingClientRect();
    if (item.left < bounds.left) strip.scrollLeft -= bounds.left - item.left;
    else if (item.right > bounds.right) strip.scrollLeft += item.right - bounds.right;
  }
  useLayoutEffect(() => {
    const strip = tabStrip.current;
    if (!strip) return;
    const update = () => {
      measureOverflow();
      revealTab(strip.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'));
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(strip);
    return () => observer?.disconnect();
  }, [selectedTabId, tabSignature]);
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

  const tabOptions = [
    ...layout.itemIds.map((itemId) => ({ id: itemId, title: dockItemRegistry[itemId].title,
      icon: getDockItemIcon(itemId), selected: !activeDynamicTab && layout.activeItemId === itemId,
      activate: () => onActivateItem(itemId) })),
    ...dynamicTabs.map((tab) => ({ id: tab.id, title: tab.title, icon: tab.icon,
      selected: tab.selected, activate: tab.onActivate }))
  ];
  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const index = tabOptions.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const next = event.key === "ArrowRight" ? (index + 1) % tabOptions.length
      : event.key === "ArrowLeft" ? (index - 1 + tabOptions.length) % tabOptions.length
        : event.key === "Home" ? 0 : event.key === "End" ? tabOptions.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    tabOptions[next].activate();
    const button = tabStrip.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
    button?.focus({ preventScroll: true });
    revealTab(button ?? null);
  }

  function handleDynamicTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    tabId: string,
  ) {
    if (!event.altKey || !event.shiftKey || !onMoveDynamicTab) {
      navigateTabs(event, tabId);
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

    navigateTabs(event, itemId);
  }

  return (
    <section
      aria-label={`${regionLabel} Dock 区域`}
      className={`dock-region dock-region-${regionId} ${dropActive ? "drop-active" : ""}`}
      data-region={regionId}
      tabIndex={-1}
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
      {hasTabs || regionActions || onSplitRegion || onCloseRegion || onCollapseRegion ? (
        <div className="dock-region-tab-row">
          {hasTabs ? (
            <div
              aria-label={`${regionLabel}标签页`}
              className="dock-tab-strip"
              ref={tabStrip}
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
                  <div className={`dock-dynamic-tab has-close ${active ? "is-active" : ""}`} key={itemId}>
                    <Tooltip
                      content={tooltipContent}
                      positioning="below"
                      relationship="description"
                    >
                      <button
                        aria-label={descriptor.title}
                        aria-selected={active}
                        className={`dock-tab ${active ? "active" : ""}`}
                        draggable={descriptor.allowedRegions.length > 1}
                        id={`dock-tab-${regionId}-${itemId}`}
                        onClick={() => onActivateItem(itemId)}
                        data-reading-entry={regionId === "main" && ["reader", "paper-note", "note-file-reader", "document-reader", "recommendation-reader", "board"].includes(itemId) ? "true" : undefined}
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
                        <span className="dock-tab-title">{descriptor.title}</span>
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
                      tabIndex={active ? 0 : -1}
                      type="button"
                    >
                      <DismissRegular />
                    </button>
                  </div>
                );
              })}
              {dynamicTabs.map((tab) => (
                <div className={`dock-dynamic-tab ${tab.onClose ? "has-close" : ""} ${tab.selected ? "is-active" : ""} ${tab.kind === "document" ? "is-document" : ""}`} key={tab.id}>
                  <button
                    aria-selected={tab.selected}
                    className={`dock-tab ${tab.kind === "document" ? "dock-document-tab" : ""} ${tab.selected ? "active" : ""}`}
                    draggable={tab.draggable && Boolean(onMoveDynamicTab)}
                    id={`dock-tab-${regionId}-${tab.id}`}
                    onClick={tab.onActivate}
                    data-reading-entry={regionId === "main" ? "true" : undefined}
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
                      tabIndex={tab.selected ? 0 : -1}
                      type="button"
                    >
                      <DismissRegular />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          <div className="dock-region-actions">
            {tabsOverflow ? (
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Tooltip content="所有标签页" relationship="label">
                    <Button appearance="subtle" size="small" aria-label={`${regionLabel}所有标签页`} icon={<ChevronDownRegular />} />
                  </Tooltip>
                </MenuTrigger>
                <MenuPopover className="dock-tabs-menu">
                  <MenuList>
                    {tabOptions.map((tab) => <MenuItem key={tab.id} icon={tab.selected ? <CheckmarkRegular /> : tab.icon ? <span>{tab.icon}</span> : undefined}
                      aria-current={tab.selected ? "page" : undefined} onClick={tab.activate} title={tab.title}>
                      {tab.title}
                    </MenuItem>)}
                  </MenuList>
                </MenuPopover>
              </Menu>
            ) : null}
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
            {onCollapseRegion ? <Tooltip content={`收起${regionLabel}面板，保留已打开页面`} relationship="description">
              <Button appearance="subtle" size="small" aria-label={`收起${regionLabel}面板`}
                icon={<DismissRegular />} onClick={onCollapseRegion} />
            </Tooltip> : null}
          </div>
        </div>
      ) : null}

      <div className="dock-region-body">
        {layout.itemIds.length === 0 && dynamicTabs.length === 0 ? (
          <DockEmptyState showActions={regionId === "main"} />
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
