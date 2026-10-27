import { layoutTabs } from "./layoutTabs";
import { SurfaceErrorBoundary, SurfaceRenderer } from "../../shared/ui/SurfaceErrorBoundary";
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
    case "metadata-editor":
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
  itemTitles?: Partial<Record<DockItemId, string>>;
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
  readingFocusTarget?: boolean;
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
  itemTitles = {},
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
  readingFocusTarget = false,
  regionActions,
  renderItem,
}: DockRegionProps) {
  const [dropActive, setDropActive] = useState(false);
  const regionElement = useRef<HTMLElement>(null);
  const tabStrip = useRef<HTMLDivElement>(null);
  const [tabBudget, setTabBudget] = useState<ReturnType<typeof layoutTabs>>();
  const tabsOverflow = Boolean(tabBudget?.overflowIds.length);
  const tabWidths = new Map(tabBudget?.visible.map(tab => [tab.id, tab.width]));
  const tabSignature = JSON.stringify([layout.itemIds, itemTitles, dynamicTabs.map(({ id, title }) => [id, title])]);
  const selectedTabId = dynamicTabs.find((tab) => tab.selected)?.id ?? layout.activeItemId;
  function measureOverflow() {
    const strip = tabStrip.current;
    const row = strip?.parentElement;
    if (!strip || !row || row.clientWidth === 0) return;
    const actions = row.querySelector<HTMLElement>(".dock-region-actions");
    const overflow = row.querySelector<HTMLElement>("[data-tab-overflow]");
    const overflowWidth = overflow?.getBoundingClientRect().width ?? 0;
    const utilityWidth = (actions?.getBoundingClientRect().width ?? 0) - overflowWidth + Math.max(44, overflowWidth);
    const font = getComputedStyle(strip.querySelector(".dock-tab") ?? strip);
    const measure = document.createElement("span");
    measure.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;pointer-events:none";
    measure.style.font = font.font;
    row.appendChild(measure);
    const entries = [...layout.itemIds.map(id => ({ id, title: itemTitles[id] ?? dockItemRegistry[id].title })), ...dynamicTabs];
    const ratio = Math.max(1, parseFloat(font.fontSize) / 13 || 1);
    const tabs = entries.map(tab => { measure.textContent = tab.title; return { id: tab.id, preferredWidth: Math.min(320 * ratio, measure.getBoundingClientRect().width + 64), minimumWidth: (tab.id === selectedTabId ? 120 : 88) * ratio }; });
    measure.remove();
    const budget = layoutTabs({ availableWidth: row.clientWidth - 10, utilityWidth, tabs, activeId: selectedTabId ?? undefined });
    setTabBudget(previous => JSON.stringify(previous) === JSON.stringify(budget) ? previous : budget);
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
    observer?.observe(strip.parentElement ?? strip);
    const actions = strip.parentElement?.querySelector(".dock-region-actions");
    if (actions) observer?.observe(actions);
    return () => observer?.disconnect();
  }, [selectedTabId, tabSignature]);
  useEffect(() => {
    const element = regionElement.current;
    if (!element) return;
    const owner = element.ownerDocument;
    const clearPreview = () => setDropActive(false);
    const leave = (event: globalThis.DragEvent) => {
      if (!(event.relatedTarget instanceof Node) || !element.contains(event.relatedTarget)) clearPreview();
    };
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") clearPreview();
    };
    // Chat is a persistent portal: React events follow its original parent, not
    // this DOM region. A cancelled drag also ends on the source, not the target.
    element.addEventListener("dragleave", leave, true);
    owner.addEventListener("drop", clearPreview, true);
    owner.addEventListener("dragend", clearPreview, true);
    owner.addEventListener("keydown", cancel, true);
    owner.defaultView?.addEventListener("blur", clearPreview);
    return () => {
      element.removeEventListener("dragleave", leave, true);
      owner.removeEventListener("drop", clearPreview, true);
      owner.removeEventListener("dragend", clearPreview, true);
      owner.removeEventListener("keydown", cancel, true);
      owner.defaultView?.removeEventListener("blur", clearPreview);
    };
  }, []);
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
    ...layout.itemIds.map((itemId) => ({ id: itemId, title: itemTitles[itemId] ?? dockItemRegistry[itemId].title,
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
    const focusTarget = () => {
      const button = document.getElementById(`dock-tab-${regionId}-${tabOptions[next].id}`);
      button?.focus({ preventScroll: true }); revealTab(button);
      return Boolean(button);
    };
    if (!focusTarget()) requestAnimationFrame(focusTarget);
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
      data-reading-focus-target={readingFocusTarget ? "true" : undefined}
      tabIndex={-1}
      ref={regionElement}
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
                if (tabBudget && !tabWidths.has(itemId)) return null;
                const descriptor = { ...dockItemRegistry[itemId], title: itemTitles[itemId] ?? dockItemRegistry[itemId].title };
                const active =
                  !activeDynamicTab && layout.activeItemId === itemId;
                const tooltipContent =
                  descriptor.allowedRegions.length > 1
                    ? `${descriptor.title} · 可拖动到其他区域`
                    : descriptor.title;
                return (
                  <div className={`dock-dynamic-tab has-close ${active ? "is-active" : ""}`} key={itemId} style={tabWidths.has(itemId) ? { width: tabWidths.get(itemId), minWidth: 0, maxWidth: "none" } : undefined}>
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
                        data-reading-entry={["reader", "paper-note", "note-file-reader", "document-reader", "recommendation-reader", "board"].includes(itemId) ? "true" : undefined}
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
              {dynamicTabs.filter(tab => !tabBudget || tabWidths.has(tab.id)).map((tab) => (
                <div className={`dock-dynamic-tab ${tab.onClose ? "has-close" : ""} ${tab.selected ? "is-active" : ""} ${tab.kind === "document" ? "is-document" : ""}`} key={tab.id} style={tabWidths.has(tab.id) ? { width: tabWidths.get(tab.id), minWidth: 0, maxWidth: "none" } : undefined}>
                  <button
                    aria-selected={tab.selected}
                    className={`dock-tab ${tab.kind === "document" ? "dock-document-tab" : ""} ${tab.selected ? "active" : ""}`}
                    draggable={tab.draggable && Boolean(onMoveDynamicTab)}
                    id={`dock-tab-${regionId}-${tab.id}`}
                    onClick={tab.onActivate}
                    data-reading-entry="true"
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
                    <Button appearance="subtle" size="small" aria-label={`${regionLabel}所有标签页`} data-tab-overflow icon={<ChevronDownRegular />}>{tabBudget?.overflowIds.length}</Button>
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
                  data-tour-page={itemId}
                  data-error-surface={itemId}
                  data-error-instance={`${regionId}:${itemId}`}
                  hidden={!active}
                  key={itemId}
                  role="tabpanel"
                >
                  <SurfaceErrorBoundary surface={itemId} instance={`${regionId}:${itemId}`} onClose={() => onCloseItem(itemId)}><SurfaceRenderer render={() => renderItem(itemId, regionId)} /></SurfaceErrorBoundary>
                </div>
              );
            })}
            {dynamicTabs.map((tab) => (
              <div
                aria-labelledby={`dock-tab-${regionId}-${tab.id}`}
                className="dock-item-host"
                hidden={!tab.selected}
                data-error-surface={tab.kind ?? "document"}
                data-error-instance={`${regionId}:${tab.id}`}
                key={tab.id}
                role="tabpanel"
              >
                <SurfaceErrorBoundary surface={tab.kind ?? "document"} instance={`${regionId}:${tab.id}`} onClose={tab.onClose}><SurfaceRenderer render={() => tab.kind === "document" && !tab.selected ? null : tab.render()} /></SurfaceErrorBoundary>
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
