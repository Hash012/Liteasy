import { useEffect, useRef } from "react";

const handlers = new Set<{ priority: number; run: () => void }>();
export function useBackHandler(enabled: boolean, run: () => void, priority = 0) {
  const latest = useRef(run); latest.current = run;
  useEffect(() => {
    if (!enabled) return;
    const entry = { priority, run: () => latest.current() }; handlers.add(entry);
    return () => { handlers.delete(entry); };
  }, [enabled, priority]);
}
export function hasOpenDialog() { return document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]'); }
export function navigateBack() {
  const dialog = hasOpenDialog();
  if (dialog) { dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); return true; }
  const current = [...handlers].sort((a, b) => b.priority - a.priority)[0];
  if (!current) return false;
  current.run(); return true;
}
