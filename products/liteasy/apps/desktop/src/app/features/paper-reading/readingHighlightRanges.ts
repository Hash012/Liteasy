import { compactPdfTextForSearch } from "../pdf/pdfTextSearch";

/** Index text nodes once per render, rather than retaining a per-character object graph. */
export function indexReadingHighlights(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(".mineru-markdown")).filter((body) => {
    const pane = body.closest(".paper-resource-tab__reading-pane");
    return !pane || pane.getAttribute("aria-label") === "原文";
  }).map((body) => {
    const page = Number(body.closest<HTMLElement>("[data-reading-page]")?.dataset.readingPage) || undefined;
    const nodes: { node: Text; from: number; to: number }[] = [];
    const parts: string[] = []; let length = 0;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.parentElement?.closest('[aria-hidden="true"], .katex-mathml, script, style')) continue;
      const text = compactPdfTextForSearch(node.data);
      nodes.push({ node, from: length, to: length + text.length });
      parts.push(text); length += text.length;
    }
    return { page, nodes, text: parts.join("") };
  });
}
function domOffset(text: string, foldedOffset: number, end: boolean) {
  let source = 0; let folded = 0;
  for (const character of text) {
    folded += compactPdfTextForSearch(character).length;
    if (folded > foldedOffset) return source + (end ? character.length : 0);
    source += character.length;
  }
  return text.length;
}

/** Ambiguous quotes stay in the entry list; never attach them to a guessed paragraph. */
export function readingHighlightRange(root: HTMLElement | ReturnType<typeof indexReadingHighlights>, quote: string, page: number): Range | undefined {
  const needle = compactPdfTextForSearch(quote);
  if (!needle) return;
  const matches: Range[] = [];
  for (const body of Array.isArray(root) ? root : indexReadingHighlights(root)) {
    if (body.page && body.page !== page) continue;
    const start = body.text.indexOf(needle);
    if (start < 0) continue;
    if (body.text.indexOf(needle, start + 1) >= 0) return;
    const end = start + needle.length - 1;
    const first = body.nodes.find((run) => run.from <= start && run.to > start)!;
    const last = body.nodes.find((run) => run.from <= end && run.to > end)!;
    const range = document.createRange();
    range.setStart(first.node, domOffset(first.node.data, start - first.from, false));
    range.setEnd(last.node, domOffset(last.node.data, end - last.from, true));
    matches.push(range);
  }
  return matches.length === 1 ? matches[0] : undefined;
}
