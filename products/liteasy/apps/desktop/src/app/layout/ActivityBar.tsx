import { Button, Tooltip } from "@fluentui/react-components";
import {
  BookRegular,
  BotRegular,
  FolderOpenRegular,
  PeopleRegular,
  PersonRegular,
  QuestionCircleRegular,
  SettingsRegular
} from "@fluentui/react-icons";
import type { ReactElement, ReactNode } from "react";
import type { LeftRailView } from "./useLeftRailNavigation";

type ActivityBarProps = {
  agentOpen?: boolean;
  helpOpen?: boolean;
  onOpenAgent?: () => void;
  onOpenHelp?: () => void;
  layoutControls?: ReactNode;
  activeView: LeftRailView;
  accountSessionAvailable?: boolean;
  onToggleActiveView?: (view: LeftRailView) => void;
  onSelectView: (view: LeftRailView) => void;
};

const activityItems: Array<{ icon: ReactElement; label: string; view: LeftRailView }> = [
  { icon: <BookRegular />, label: "文献库", view: "library" },
  { icon: <FolderOpenRegular />, label: "产物库", view: "artifact-library" },
  { icon: <PeopleRegular />, label: "组织", view: "organization" },
  { icon: <PersonRegular />, label: "个人中心", view: "profile" },
  { icon: <SettingsRegular />, label: "设置", view: "settings" }
];

export function ActivityBar({
  agentOpen = false,
  helpOpen = false,
  onOpenAgent,
  onOpenHelp,
  layoutControls,
  activeView,
  accountSessionAvailable = true,
  onToggleActiveView,
  onSelectView
}: ActivityBarProps) {
  return (
    <nav aria-label="左边栏导航" className="activity-bar">
      {activityItems.map((item) => (
        <Tooltip content={item.label} key={item.view} positioning="after" relationship="description">
          <Button
            appearance="subtle"
            aria-label={item.label}
            className={activeView === item.view ? "activity-button active" : "activity-button"}
            icon={item.icon}
            onClick={() =>
              activeView === item.view
                ? onToggleActiveView?.(item.view)
                : onSelectView(item.view)
            }
            type="button"
          >
            {item.view === "profile" && !accountSessionAvailable ? (
              <span className="activity-login-badge">未登录</span>
            ) : null}
          </Button>
        </Tooltip>
      ))}
      {onOpenAgent ? <Tooltip content="Agent" positioning="after" relationship="description">
        <Button appearance="subtle" aria-label="Agent" aria-pressed={agentOpen} className={`activity-button${agentOpen ? " active" : ""}`} icon={<BotRegular />} onClick={onOpenAgent} />
      </Tooltip> : null}
      {onOpenHelp ? <Tooltip content="帮助 · F1" positioning="after" relationship="description">
        <Button appearance="subtle" aria-label="帮助" aria-pressed={helpOpen} className={`activity-button${helpOpen ? " active" : ""}`} icon={<QuestionCircleRegular />} onClick={onOpenHelp} />
      </Tooltip> : null}
      {layoutControls}
    </nav>
  );
}
