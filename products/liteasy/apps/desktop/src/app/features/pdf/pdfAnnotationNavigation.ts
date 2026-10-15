import type { KeyboardEvent } from "react";

/** Handle only summary-button keys; text editors keep their own cursor navigation. */
export function navigatePdfAnnotationList(event: KeyboardEvent<HTMLButtonElement>, onLocate: () => void) {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey) {
    event.preventDefault();
    event.stopPropagation();
    onLocate();
    return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const entries = Array.from(event.currentTarget.closest(".pdf-annotation-list")?.querySelectorAll<HTMLButtonElement>(".pdf-annotation-summary") ?? []);
  const index = entries.indexOf(event.currentTarget);
  if (index < 0) return;
  const target = event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1
    : Math.max(0, Math.min(entries.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)));
  event.preventDefault();
  event.stopPropagation();
  entries[target]?.focus({ preventScroll: true });
  entries[target]?.scrollIntoView?.({ block: "nearest" });
}
