import { useLayoutEffect, useRef, useState } from "react";
import { Button, Menu, MenuItem, MenuItemCheckbox, MenuList, MenuPopover, MenuTrigger, Toolbar, Tooltip } from "@fluentui/react-components";
import { ArrowLeftRegular, ArrowRightRegular, MoreHorizontalRegular, PanelLeftRegular, SearchRegular, SettingsRegular } from "@fluentui/react-icons";
import type { ToolbarAction, WorkspaceToolbarState } from "../features/workspace/workspaceShell.types";
import "../styles/workspaceShell.css";

function actionIcon(icon: ToolbarAction["icon"]) {
  if (icon === "search") return <SearchRegular />;
  if (icon === "layout") return <PanelLeftRegular />;
  if (icon === "settings") return <SettingsRegular />;
  return undefined;
}

function ActionMenuItems({ actions }: { actions: ToolbarAction[] }) {
  const checkedValues = Object.fromEntries(actions.filter((action) => action.checked !== undefined).map((action) => [action.id, action.checked ? ["visible"] : []]));
  return <MenuList checkedValues={checkedValues}>{actions.map((action) => action.children?.length ? (
    <Menu key={action.id}>
      <MenuTrigger disableButtonEnhancement>
        <MenuItem icon={actionIcon(action.icon)}>{action.label}</MenuItem>
      </MenuTrigger>
      <MenuPopover><ActionMenuItems actions={action.children} /></MenuPopover>
    </Menu>
  ) : action.checked !== undefined ? (
    <MenuItemCheckbox key={action.id} name={action.id} value="visible" onClick={action.onSelect}>
      {action.label}
    </MenuItemCheckbox>
  ) : <MenuItem key={action.id} icon={actionIcon(action.icon)} onClick={action.onSelect}>{action.label}</MenuItem>)}</MenuList>;
}

function ActionButton({ action }: { action: ToolbarAction }) {
  const button = <Button className="shell-icon-button" appearance="subtle" aria-label={action.label} icon={actionIcon(action.icon)} onClick={action.children ? undefined : action.onSelect} />;
  return action.children?.length ? (
    <Menu>
      <MenuTrigger disableButtonEnhancement><Tooltip content={action.label} relationship="description">{button}</Tooltip></MenuTrigger>
      <MenuPopover><ActionMenuItems actions={action.children} /></MenuPopover>
    </Menu>
  ) : <Tooltip content={action.label} relationship="description">{button}</Tooltip>;
}

export function WorkspaceCommandBar({ state }: { state: WorkspaceToolbarState }) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    setWidth(element.clientWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const actions = state.actions ?? [];
  // Reserve navigation, overflow, and a readable title before allocating commands.
  const capacity = Math.max(0, Math.floor((width - 350) / 38));
  const visibleIds = new Set([...actions].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)).slice(0, capacity).map((action) => action.id));
  const overflow = [...actions.filter((action) => !visibleIds.has(action.id)), ...(state.overflowActions ?? [])];
  const title = [...(state.breadcrumb?.map((item) => item.label) ?? []), state.title].filter(Boolean).join(" / ");
  return (
    <Toolbar ref={root} aria-label="工作区命令栏" className="workspace-command-bar">
      <div className="shell-navigation">
        <Tooltip content="后退" relationship="description"><Button className="shell-icon-button" appearance="subtle" aria-label="后退" disabled={!state.canGoBack} icon={<ArrowLeftRegular />} onClick={state.onGoBack} /></Tooltip>
        <Tooltip content="前进" relationship="description"><Button className="shell-icon-button" appearance="subtle" aria-label="前进" disabled={!state.canGoForward} icon={<ArrowRightRegular />} onClick={state.onGoForward} /></Tooltip>
      </div>
      <div className="shell-workspace-title" title={title}>{title || "Liteasy"}</div>
      <div className="shell-commands">
        {actions.filter((action) => visibleIds.has(action.id)).map((action) => <ActionButton key={action.id} action={action} />)}
        {overflow.length > 0 ? <Menu>
          <MenuTrigger disableButtonEnhancement>
            <Tooltip content="更多工作区操作" relationship="description"><Button className="shell-icon-button" appearance="subtle" aria-label="更多工作区操作" icon={<MoreHorizontalRegular />} /></Tooltip>
          </MenuTrigger>
          <MenuPopover><ActionMenuItems actions={overflow} /></MenuPopover>
        </Menu> : null}
      </div>
    </Toolbar>
  );
}
