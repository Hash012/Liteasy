import { useContext, useEffect, useRef } from "react";
import { ReferenceSourceContext } from "./ResourceReferencesContext";
import { VisualResourceContext } from "../visual-blocks/AssetImage";
export type ResourceReveal = { path: string; line?: number; quote?: string; expires: number };
let pending: ResourceReveal | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
function identity(path: string) {
  try { const url = new URL(path); url.hash = ""; for (const key of ["revision", "latest", "followLatest", "selector"]) url.searchParams.delete(key); url.searchParams.sort(); return url.href; }
  catch { return path; }
}
/** Navigation only, after the caller verifies its locator revision; never edits content. */
export function revealResource(input: Omit<ResourceReveal, "expires">) {
  clearTimeout(timer); pending = { ...input, expires: Date.now() + 5000 };
  timer = setTimeout(() => { pending = undefined; }, 5000);
  for (const listener of listeners) listener();
}
export function useResourceReveal(reveal: (target: ResourceReveal) => void | (() => void), explicitPath?: string) {
  const inherited = useContext(ReferenceSourceContext), visual = useContext(VisualResourceContext);
  const path = explicitPath ?? inherited ?? visual;
  const latest = useRef(reveal); latest.current = reveal;
  useEffect(() => {
    let cleanup: void | (() => void);
    const receive = () => { if (pending && path && pending.expires > Date.now() && identity(pending.path) === identity(path)) { cleanup?.(); cleanup = latest.current(pending); } };
    listeners.add(receive); receive(); return () => { listeners.delete(receive); cleanup?.(); };
  }, [path]);
}
export function revealOffset(text: string, target: ResourceReveal) {
  const lines = text.split("\n");
  const start = lines.slice(0, Math.max(0, (target.line ?? 1) - 1)).reduce((n, line) => n + line.length + 1, 0);
  const found = target.quote ? text.toLowerCase().indexOf(target.quote.toLowerCase(), start) : -1;
  return Math.min(text.length, found >= 0 ? found : start);
}
export function revealRenderedResource(root: HTMLElement | null, target: ResourceReveal) {
  if (!root || root.closest(".markdown-live-editor")) return;
  const blocks = [...root.querySelectorAll<HTMLElement>("[data-source-line]")];
  const line = target.line ?? 1;
  const block = blocks.filter((element) => Number(element.dataset.sourceLine) <= line).at(-1) ?? blocks[0];
  let element: HTMLElement | undefined = block;
  if (!element && target.quote) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let node;
    while ((node = walker.nextNode())) { if (node.textContent?.toLowerCase().includes(target.quote.toLowerCase())) { element = node.parentElement ?? undefined; break; } }
  }
  if (element) { element.scrollIntoView?.({ block: "center" }); element.classList.add("resource-search-location"); setTimeout(() => element?.classList.remove("resource-search-location"), 3000); }
}
/** Unified Markdown source positions, also usable by other locator consumers. */
export function rehypeResourcePositions() {
  return (tree: { children?: unknown[] }) => {
    const visit = (node: { type?: string; properties?: Record<string, unknown>; position?: { start?: { line?: number } }; children?: unknown[] }) => {
      if (node.type === "element" && node.position?.start?.line) { node.properties ??= {}; node.properties["data-source-line"] = node.position.start.line; }
      for (const child of node.children ?? []) visit(child as typeof node);
    };
    visit(tree);
  };
}

export function observeRenderedResource(root: HTMLElement | null, target: ResourceReveal) {
  if (!root || root.closest(".markdown-live-editor")) return;
  revealRenderedResource(root, target);
  const observer = new MutationObserver(() => revealRenderedResource(root, target));
  observer.observe(root, { childList: true, subtree: true });
  const timeout = setTimeout(() => observer.disconnect(), Math.max(0, target.expires - Date.now()));
  return () => { observer.disconnect(); clearTimeout(timeout); };
}
