import type { LeftRailView } from "./useLeftRailNavigation";

type ActivityBarProps = {
  activeView: LeftRailView;
  onSelectView: (view: LeftRailView) => void;
};

const activityItems: Array<{ label: string; view: LeftRailView }> = [
  { label: "文献库", view: "library" },
  { label: "组织", view: "organization" },
  { label: "个人中心", view: "profile" },
  { label: "设置", view: "settings" }
];

export function ActivityBar({ activeView, onSelectView }: ActivityBarProps) {
  return (
    <nav aria-label="左边栏导航" className="activity-bar">
      {activityItems.map((item) => (
        <button
          className={activeView === item.view ? "activity-button active" : "activity-button"}
          key={item.view}
          onClick={() => onSelectView(item.view)}
          title={item.label}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
