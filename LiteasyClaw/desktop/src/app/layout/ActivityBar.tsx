import type { LeftRailView } from "./useLeftRailNavigation";

type ActivityBarProps = {
  activeView: LeftRailView;
  accountSessionAvailable?: boolean;
  onToggleActiveView?: (view: LeftRailView) => void;
  onSelectView: (view: LeftRailView) => void;
};

const activityItems: Array<{ label: string; view: LeftRailView }> = [
  { label: "文献库", view: "library" },
  { label: "组织", view: "organization" },
  { label: "个人中心", view: "profile" },
  { label: "设置", view: "settings" }
];

export function ActivityBar({
  activeView,
  accountSessionAvailable = true,
  onToggleActiveView,
  onSelectView
}: ActivityBarProps) {
  return (
    <nav aria-label="左边栏导航" className="activity-bar">
      {activityItems.map((item) => (
        <button
          aria-label={item.label}
          className={activeView === item.view ? "activity-button active" : "activity-button"}
          key={item.view}
          onClick={() =>
            activeView === item.view
              ? onToggleActiveView?.(item.view)
              : onSelectView(item.view)
          }
          title={item.label}
          type="button"
        >
          <span className="activity-button-label">{item.label}</span>
          {item.view === "profile" && !accountSessionAvailable ? (
            <span className="activity-login-badge">未登录</span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
