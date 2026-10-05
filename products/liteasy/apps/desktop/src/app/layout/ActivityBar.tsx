import { message } from "../shared/i18n/i18n";
import { useUiTranslation } from "../shared/i18n/useUiTranslation";
import { Button, Tooltip } from "@fluentui/react-components";
import {
  BookRegular,
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
import { commandShortcut } from "../features/workbench/workbenchCommands";

type ActivityBarProps = {
  onExpandLibrary?: () => void;
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
  { icon: <BookRegular />, get label() { return message("shell.library"); }, view: "library" },
  { icon: <FolderOpenRegular />, get label() { return message("shell.artifacts"); }, view: "artifact-library" },
  { icon: <PeopleRegular />, get label() { return message("shell.organization"); }, view: "organization" },
  { icon: <PersonRegular />, get label() { return message("shell.profile"); }, view: "profile" },
  { icon: <SettingsRegular />, get label() { return message("shell.settings"); }, view: "settings" },
];

export function ActivityBar({
  onExpandLibrary,
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
  useUiTranslation();
  return (
    <nav aria-label={message("shell.navigation")} className="activity-bar">

      {activityItems.map((item) => (
        <Tooltip
          content={item.view === "library" ? message("shell.library.tooltip", { shortcut: commandShortcut("library") }) : item.view === "settings" ? message("shell.settings.tooltip", { shortcut: commandShortcut("settings") }) : item.label}
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
            onKeyDown={item.view === "library" ? (event) => { if (event.key === "Enter" && event.shiftKey) { event.preventDefault(); onExpandLibrary?.(); } } : undefined}
            onDoubleClick={item.view === "library" ? (event) => { event.preventDefault(); onExpandLibrary?.(); } : undefined}
            onClick={(event) => {
              if (event.detail > 1 && item.view === "library") return;
              return activeView === item.view
                ? onToggleActiveView?.(item.view)
                : onSelectView(item.view);
            }}
            type="button"
          >
            {item.view === "profile" && !accountSessionAvailable ? (
              <span className="activity-login-badge">{message("shell.signedOut")}</span>
            ) : null}
          </Button>
        </Tooltip>
      ))}
      {onOpenNotes ? (
        <Tooltip
          content={message("shell.notesTooltip")}
          positioning="after"
          relationship="description"
        >
          <Button
            appearance="subtle"
            aria-label={message("shell.notes")}
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
        <Tooltip content={message("shell.assistant.tooltip", { shortcut: commandShortcut("assistant") })} positioning="after" relationship="description">
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
          content={message("shell.helpTooltip")}
          positioning="after"
          relationship="description"
        >
          <Button
            appearance="subtle"
            aria-label={message("shell.help")}
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
