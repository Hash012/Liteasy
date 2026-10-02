import { useEffect, useRef, useState } from "react";
import { matchWorkbenchShortcut, type WorkbenchCommandAvailability, type WorkbenchCommandId } from "../features/workbench/workbenchCommands";

type CommandActions = Partial<Record<Exclude<WorkbenchCommandId, "commands">, () => void>>;
const focusSelectors: Partial<Record<WorkbenchCommandId, string>> = {
  assistant: "textarea.assistant-input",
  library: 'input[aria-label="搜索文献资源"]',
  settings: 'input[aria-label="搜索设置"]'
};

export function useWorkbenchCommandsController(actions: CommandActions, availability: WorkbenchCommandAvailability = {}) {
  const latest = useRef(actions);
  latest.current = actions;
  const allowed = useRef(availability);
  allowed.current = availability;
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<{ command: WorkbenchCommandId }>();
  function execute(command: WorkbenchCommandId) {
    if (allowed.current[command] || command !== "commands" && !latest.current[command]) return;
    setOpen(command === "commands");
    if (command === "commands") return;
    latest.current[command]?.();
    setFocus({ command });
  }
  const executeRef = useRef(execute);
  executeRef.current = execute;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const command = matchWorkbenchShortcut(event);
      if (!command) return;
      // Do not navigate behind an import, account or metadata dialog.
      const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], [role="alertdialog"]')]
        .find((element) => !element.closest("[hidden]") && element.getAttribute("aria-label") !== "快捷操作");
      if (dialog && !(dialog.getAttribute("aria-label") === "页面切换" && (command === "page-history" || command === "active-pages"))) return;
      event.preventDefault();
      executeRef.current(command);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (!focus) return;
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => {
      const selector = focusSelectors[focus.command];
      if (selector) [...document.querySelectorAll<HTMLElement>(selector)].find((element) => element.getClientRects().length > 0 && !element.closest("[hidden], [inert]"))?.focus();
    }); });
    return () => cancelAnimationFrame(frame);
  }, [focus]);
  return { open, execute, close: () => setOpen(false) };
}
