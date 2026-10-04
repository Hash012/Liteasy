import { compileSearchQuery } from "./searchQuery";
import "./search.css";

type ActiveHighlight = { ranges: Range[]; timer?: ReturnType<typeof setTimeout>; observer?: MutationObserver };
const active = new Map<HTMLElement, ActiveHighlight>();
type HighlightWindow = Window & { Highlight?: new (...ranges: Range[]) => unknown; CSS: { highlights?: Map<string, unknown> } };
function render() {
  const view = window as unknown as HighlightWindow;
  if (!view.Highlight || !view.CSS?.highlights) return;
  const ranges = [...active.entries()].filter(([root]) => root.isConnected).flatMap(([, entry]) => entry.ranges);
  if (ranges.length) view.CSS.highlights.set("liteasy-search-match", new view.Highlight(...ranges));
  else view.CSS.highlights.delete("liteasy-search-match");
}
/** Paint exact DOM ranges without replacing React nodes or altering the user's selection/document. */
export function highlightSearchText(root: HTMLElement, query: string, occurrence?: number) {
  const build = () => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode(node) {
      const hidden = node.parentElement?.closest("script, style, button, textarea, .katex-mathml, [aria-hidden='true']");
      // A closing modal briefly hides the entire app from accessibility; that ancestor is not document content.
      return hidden && root.contains(hidden) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    } });
    const nodes: { node: Text; offset: number }[] = []; let text = "";
    while (walker.nextNode()) { const node = walker.currentNode as Text; nodes.push({ node, offset: text.length }); text += node.data; }
    const matches = compileSearchQuery(query, { phrase: true }).ranges(text);
    const chosen = occurrence === undefined ? matches : matches.slice(occurrence, occurrence + 1);
    return chosen.flatMap((match) => {
      const first = nodes.find(({ node, offset }) => offset + node.length > match.start);
      const last = nodes.find(({ node, offset }) => offset + node.length >= match.end);
      if (!first || !last) return [];
      const range = document.createRange(); range.setStart(first.node, match.start - first.offset); range.setEnd(last.node, match.end - last.offset);
      return [range];
    });
  };
  const previous = active.get(root); if (previous) { clearTimeout(previous.timer); previous.observer?.disconnect(); }
  const entry: ActiveHighlight = { ranges: build() };
  const clear = () => { if (active.get(root) === entry) { clearTimeout(entry.timer); entry.observer?.disconnect(); active.delete(root); render(); } };
  // React/Markdown may replace text nodes after navigation. Rebind ranges without
  // mutating the DOM, so the new content keeps its highlight and never autosaves.
  entry.observer = new MutationObserver(() => { entry.ranges = build(); render(); });
  entry.observer.observe(root, { childList: true, subtree: true, characterData: true });
  entry.timer = setTimeout(clear, 8000);
  active.set(root, entry); render();
  return { ranges: entry.ranges, clear, element: entry.ranges[0]?.startContainer.parentElement };
}
