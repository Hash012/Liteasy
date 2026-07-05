import type { PaneCollapseState } from "./paneLayout.types";

function getToggleLabel(target: "bottom" | "left" | "right", collapsed: boolean) {
  const action = collapsed ? "展开" : "折叠";

  if (target === "bottom") {
    return `${action}下栏`;
  }
  if (target === "left") {
    return `${action}左侧栏`;
  }
  return `${action}右侧栏`;
}

function LayoutToggleButton({
  collapsed,
  icon,
  onToggle,
  target
}: {
  collapsed: boolean;
  icon: "bottom" | "left" | "right";
  onToggle?: () => void;
  target: "bottom" | "left" | "right";
}) {
  const label = getToggleLabel(target, collapsed);

  return (
    <button
      aria-label={label}
      aria-pressed={collapsed}
      className={collapsed ? "reader-layout-button collapsed" : "reader-layout-button"}
      onClick={onToggle}
      title={label}
      type="button"
    >
      <span aria-hidden="true" className={`reader-layout-icon ${icon}`} />
    </button>
  );
}

export function DockLayoutControls({
  collapsed,
  onToggleBottom,
  onToggleLeft,
  onToggleRight
}: {
  collapsed: PaneCollapseState;
  onToggleBottom?: () => void;
  onToggleLeft?: () => void;
  onToggleRight?: () => void;
}) {
  return (
    <div aria-label="阅读区布局控制" className="reader-layout-controls" role="toolbar">
      <LayoutToggleButton
        collapsed={collapsed.left}
        icon="left"
        onToggle={onToggleLeft}
        target="left"
      />
      <LayoutToggleButton
        collapsed={collapsed.bottom}
        icon="bottom"
        onToggle={onToggleBottom}
        target="bottom"
      />
      <LayoutToggleButton
        collapsed={collapsed.right}
        icon="right"
        onToggle={onToggleRight}
        target="right"
      />
    </div>
  );
}
