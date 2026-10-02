import { DocumentRegular, FolderOpenRegular, BookOpenRegular, BeakerRegular, PlayCircleRegular, ArrowUndoRegular, AppsRegular, HistoryRegular, BookRegular, BotRegular, QuestionCircleRegular, SearchRegular, SettingsRegular } from "@fluentui/react-icons";
import { LiteasyMark } from "./LiteasyMark";
import { commandKeys, workbenchCommands, type WorkbenchCommandId } from "./workbenchCommands";
import { useWorkbenchCommands, useWorkbenchCommandAvailability } from "./workbenchCommandsContext";
import "./workbenchWelcome.css";

export function WorkbenchCommandIcon({ id }: { id: WorkbenchCommandId }) {
  const Icon = { "open-file": BookOpenRegular, "open-note": DocumentRegular, "open-folder": FolderOpenRegular, "preset-reading": BookOpenRegular, "preset-research": BeakerRegular, "preset-processing": PlayCircleRegular, "preset-custom": ArrowUndoRegular, library: BookRegular, assistant: BotRegular, settings: SettingsRegular, help: QuestionCircleRegular, commands: SearchRegular, "page-history": HistoryRegular, "active-pages": AppsRegular }[id];
  return <Icon aria-hidden="true" />;
}
export function ShortcutKeys({ id }: { id: WorkbenchCommandId }) {
  if (!commandKeys(id).length) return null;
  return <span className="workbench-shortcut" aria-label={commandKeys(id).join(" + ")}>
    {commandKeys(id).map((key, index) => <span className="workbench-shortcut-part" key={key}>
      {index ? <span aria-hidden="true">+</span> : null}<kbd>{key}</kbd>
    </span>)}
  </span>;
}
export function WorkbenchWelcome({ compact = false }: { compact?: boolean }) {
  const execute = useWorkbenchCommands();
  const availability = useWorkbenchCommandAvailability();
  return <section className={`workbench-welcome${compact ? " is-compact" : ""}`} aria-label={compact ? "Liteasy" : "开始使用 Liteasy"}>
    <div className="workbench-welcome-content">
      <LiteasyMark className="workbench-welcome-mark" />
      {!compact ? <>
        <h1>打开资料，继续你的工作</h1>
        <div className="workbench-task-presets" role="group" aria-label="任务布局">
          {workbenchCommands.filter(command => command.id.startsWith("preset-")).map(command => <button key={command.id} type="button" title={command.description} disabled={!execute} onClick={() => execute?.(command.id)}><WorkbenchCommandIcon id={command.id} />{command.title}</button>)}
        </div>
        <div className="workbench-welcome-actions">
          {workbenchCommands.filter((command) => !["commands", "active-pages"].includes(command.id) && !command.id.startsWith("preset-")).map((command) =>
            <button key={command.id} type="button" className="workbench-welcome-action" title={availability[command.id]} disabled={!execute || Boolean(availability[command.id])} onClick={() => execute?.(command.id)}>
              <WorkbenchCommandIcon id={command.id} />
              <span className="workbench-welcome-action-copy"><span>{command.title}</span><small>{availability[command.id] ?? command.description}</small></span>
              <ShortcutKeys id={command.id} />
            </button>)}
        </div>
        <button type="button" className="workbench-welcome-more" disabled={!execute} onClick={() => execute?.("commands")}>
          <SearchRegular aria-hidden="true" /><span>查看全部快捷操作</span><ShortcutKeys id="commands" />
        </button>
      </> : null}
    </div>
  </section>;
}
