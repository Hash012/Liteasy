import { BookRegular, BotRegular, QuestionCircleRegular, SearchRegular, SettingsRegular } from "@fluentui/react-icons";
import { LiteasyMark } from "./LiteasyMark";
import { commandKeys, workbenchCommands, type WorkbenchCommandId } from "./workbenchCommands";
import { useWorkbenchCommands } from "./workbenchCommandsContext";
import "./workbenchWelcome.css";

export function WorkbenchCommandIcon({ id }: { id: WorkbenchCommandId }) {
  const Icon = { library: BookRegular, assistant: BotRegular, settings: SettingsRegular, help: QuestionCircleRegular, commands: SearchRegular }[id];
  return <Icon aria-hidden="true" />;
}
export function ShortcutKeys({ id }: { id: WorkbenchCommandId }) {
  return <span className="workbench-shortcut" aria-label={commandKeys(id).join(" + ")}>
    {commandKeys(id).map((key, index) => <span className="workbench-shortcut-part" key={key}>
      {index ? <span aria-hidden="true">+</span> : null}<kbd>{key}</kbd>
    </span>)}
  </span>;
}
export function WorkbenchWelcome({ compact = false }: { compact?: boolean }) {
  const execute = useWorkbenchCommands();
  return <section className={`workbench-welcome${compact ? " is-compact" : ""}`} aria-label={compact ? "Liteasy" : "开始使用 Liteasy"}>
    <div className="workbench-welcome-content">
      <LiteasyMark className="workbench-welcome-mark" />
      {!compact ? <>
        <h1>从这里开始研究</h1>
        <div className="workbench-welcome-actions">
          {workbenchCommands.filter((command) => command.id !== "commands").map((command) =>
            <button key={command.id} type="button" className="workbench-welcome-action" disabled={!execute} onClick={() => execute?.(command.id)}>
              <WorkbenchCommandIcon id={command.id} />
              <span className="workbench-welcome-action-copy"><span>{command.title}</span><small>{command.description}</small></span>
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
