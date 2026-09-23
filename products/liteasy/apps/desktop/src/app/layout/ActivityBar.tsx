import { Button, Tooltip } from "@fluentui/react-components";
import {
  BookRegular,
  LibraryRegular,
  NoteRegular,
  BotRegular,
  FolderOpenRegular,
  PeopleRegular,
  PersonRegular,
  QuestionCircleRegular,
  SettingsRegular,
} from "@fluentui/react-icons";
import type { ReactElement, ReactNode } from "react";
import { dockItemMimeType } from "../features/dock/DockRegion";
import type { LeftRailView } from "./useLeftRailNavigation";

type ActivityBarProps = {
  readingLibraryOpen?: boolean;
  onOpenReadingLibrary?: () => void;
  agentOpen?: boolean;
  notesOpen?: boolean;
  onOpenNotes?: () => void;
  helpOpen?: boolean;
  onOpenAgent?: () => void;
  onOpenHelp?: () => void;
  layoutControls?: ReactNode;
  activeView: LeftRailView;
  isViewVisible?: (view: LeftRailView) => boolean;
  accountSessionAvailable?: boolean;
  onToggleActiveView?: (view: LeftRailView) => void;
  onSelectView: (view: LeftRailView) => void;
};

const activityItems: Array<{
  icon: ReactElement;
  label: string;
  view: LeftRailView;
}> = [
  { icon: <BookRegular />, label: "文献库", view: "library" },
  { icon: <FolderOpenRegular />, label: "产物库", view: "artifact-library" },
  { icon: <PeopleRegular />, label: "组织", view: "organization" },
  { icon: <PersonRegular />, label: "个人中心", view: "profile" },
  { icon: <SettingsRegular />, label: "设置", view: "settings" },
];

export function ActivityBar({
  readingLibraryOpen = false,
  onOpenReadingLibrary,
  agentOpen = false,
  notesOpen = false,
  onOpenNotes,
  helpOpen = false,
  onOpenAgent,
  onOpenHelp,
  layoutControls,
  activeView,
  isViewVisible = (view) => view === activeView,
  accountSessionAvailable = true,
  onToggleActiveView,
  onSelectView,
}: ActivityBarProps) {
  return (
    <nav aria-label="左边栏导航" className="activity-bar">
      {onOpenReadingLibrary ? <Tooltip content="书库与元信息" positioning="after" relationship="description">
        <Button appearance="subtle" aria-label="书库与元信息" aria-pressed={readingLibraryOpen}
          className={`activity-button${readingLibraryOpen ? " active" : ""}`} icon={<LibraryRegular />}
          onClick={onOpenReadingLibrary} />
      </Tooltip> : null}
      {activityItems.map((item) => (
        <Tooltip
          content={item.label}
          key={item.view}
          positioning="after"
          relationship="description"
        >
          <Button
            appearance="subtle"
            aria-label={item.label}
            aria-pressed={isViewVisible(item.view)}
            className={
              isViewVisible(item.view)
                ? "activity-button active"
                : "activity-button"
            }
            icon={item.icon}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(dockItemMimeType, item.view);
            }}
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
      {onOpenNotes ? (
        <Tooltip
          content="笔记 / Notes"
          positioning="after"
          relationship="description"
        >
          <Button
            appearance="subtle"
            aria-label="笔记"
            aria-pressed={notesOpen}
            className={`activity-button${notesOpen ? " active" : ""}`}
            icon={<NoteRegular />}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(dockItemMimeType, "notes");
            }}
            onClick={onOpenNotes}
          />
        </Tooltip>
      ) : null}
      {onOpenAgent ? (
        <Tooltip content="Agent" positioning="after" relationship="description">
          <Button
            appearance="subtle"
            aria-label="Agent"
            aria-pressed={agentOpen}
            className={`activity-button${agentOpen ? " active" : ""}`}
            icon={<BotRegular />}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(dockItemMimeType, "assistant");
            }}
            onClick={onOpenAgent}
          />
        </Tooltip>
      ) : null}
      {onOpenHelp ? (
        <Tooltip
          content="帮助 · F1"
          positioning="after"
          relationship="description"
        >
          <Button
            appearance="subtle"
            aria-label="帮助"
            aria-pressed={helpOpen}
            className={`activity-button${helpOpen ? " active" : ""}`}
            icon={<QuestionCircleRegular />}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(dockItemMimeType, "help");
            }}
            onClick={onOpenHelp}
          />
        </Tooltip>
      ) : null}
      {layoutControls}
    </nav>
  );
}
