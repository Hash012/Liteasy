import { message } from "../../shared/i18n/i18n";
import { useUiTranslation } from "../../shared/i18n/useUiTranslation";
import { useWorkbenchCommandAvailability } from "./workbenchCommandsContext";
import { useState } from "react";
import { Button, Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle, Input } from "@fluentui/react-components";
import { DismissRegular, SearchRegular } from "@fluentui/react-icons";
import { ShortcutKeys, WorkbenchCommandIcon } from "./WorkbenchWelcome";
import { commandShortcut, workbenchCommands, type WorkbenchCommandId } from "./workbenchCommands";

export function WorkbenchCommandsDialog({ onClose, onExecute }: { onClose: () => void; onExecute: (id: WorkbenchCommandId) => void }) {
  useUiTranslation();
  const [query, setQuery] = useState("");
  const availability = useWorkbenchCommandAvailability();
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const commands = workbenchCommands.filter((command) => command.id !== "commands" && terms.every((term) =>
    `${command.title} ${command.description} ${command.search} ${commandShortcut(command.id)}`.toLowerCase().includes(term)));
  return <Dialog open onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
    <DialogSurface aria-label={message("commands.dialog.title")} className="workbench-commands-dialog"><DialogBody>
      <DialogTitle action={<Button appearance="subtle" aria-label={message("commands.dialog.close")} icon={<DismissRegular />} onClick={onClose} />}>{message("commands.dialog.title")}</DialogTitle>
      <DialogContent>
        <Input autoFocus aria-label={message("commands.dialog.search")} placeholder={message("commands.dialog.placeholder")} value={query} contentBefore={<SearchRegular />} onChange={(_, data) => setQuery(data.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") { const first = commands.find(command => !availability[command.id]); if (first) { event.preventDefault(); onExecute(first.id); } }
            if (event.key === "ArrowDown") { event.preventDefault(); event.currentTarget.closest("[role=dialog]")?.querySelector<HTMLButtonElement>(".workbench-command-option:not(:disabled)")?.focus(); }
          }} />
        <div className="workbench-command-list" aria-label={message("commands.dialog.available")}>
          {commands.map((command) => <button type="button" className="workbench-command-option" key={command.id} disabled={Boolean(availability[command.id])} title={availability[command.id] ?? command.description} onClick={() => onExecute(command.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              const options = [...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
              options[(options.indexOf(event.currentTarget) + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length]?.focus();
            }}>
            <WorkbenchCommandIcon id={command.id} /><span>{command.title}{availability[command.id] ? <small className="workbench-command-reason">{availability[command.id]}</small> : null}</span><ShortcutKeys id={command.id} />
          </button>)}
          {!commands.length ? <p role="status">{message("commands.dialog.none")}</p> : null}
        </div>
        <small>{message("commands.dialog.keyboard")}</small>
      </DialogContent>
    </DialogBody></DialogSurface>
  </Dialog>;
}
