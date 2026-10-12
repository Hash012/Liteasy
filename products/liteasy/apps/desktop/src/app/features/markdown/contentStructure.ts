import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { contentFragmentSchema, type ContentFragment } from "./contentFragment";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
export type ContentBlock = { start: number; end: number; type: string; atomic: boolean };
/** Source positions always refer to original UTF-16, before CRLF/math/render normalization. */
export function contentBlocks(text: string): ContentBlock[] {
  const tree = parser.parse(text);
  return tree.children.flatMap(node => {
    const start = node.position?.start.offset, end = node.position?.end.offset;
    return start === undefined || end === undefined ? [] : [{ start, end, type: node.type,
      atomic: ["table", "html", "code", "math", "list", "definition", "footnoteDefinition"].includes(node.type) }];
  });
}
export function safeUtf16Range(text: string, start: number, end: number) {
  start = Math.max(0, Math.min(text.length, start));
  end = Math.max(start, Math.min(text.length, end));
  // Do not consume an extra code unit outside the caller's budget.
  if (start < text.length && /[\uDC00-\uDFFF]/.test(text[start])) start++;
  if (end < text.length && /[\uDC00-\uDFFF]/.test(text[end])) end--;
  return { start, end: Math.max(start, end), unit: "utf16" as const };
}
export function sourceContent(input: {
  text: string; path: string; revision?: string; scopeId: string; start?: number; end?: number;
  profile?: ContentFragment["profile"]; maxViewCharacters?: number;
}): ContentFragment {
  const { text, path, revision, scopeId } = input;
  const exact = safeUtf16Range(text, input.start ?? 0, input.end ?? text.length);
  const profile = input.profile ?? "liteasy-research-markdown/v1";
  const blocks = profile === "literal/v1" ? [] : contentBlocks(text);
  const overlapping = blocks.filter(block => block.end > exact.start && block.start < exact.end);
  const start = Math.min(exact.start, ...overlapping.map(block => block.start));
  const end = Math.max(exact.end, ...overlapping.map(block => block.end));
  const definitions = blocks.filter(block => ["definition", "footnoteDefinition"].includes(block.type) && (block.end <= start || block.start >= end));
  const ranges = [{ start, end }, ...definitions].sort((a, b) => a.start - b.start).map(({ start, end }) => ({ start, end, unit: "utf16" as const }));
  const view = ranges.map(range => text.slice(range.start, range.end)).join("\n\n");
  const overBudget = view.length > (input.maxViewCharacters ?? 80000);
  const expanded = start !== exact.start || end !== exact.end || definitions.length > 0;
  // Unclosed HTML tables/fences remain explicit snapshots; never fabricate closing syntax.
  const selected = text.slice(exact.start, exact.end);
  const incomplete = overlapping.some(block => {
    const body = text.slice(block.start, block.end);
    if (block.type === "html" && /<table\b/i.test(body)) return !/<\/table\s*>/i.test(body);
    if (block.type === "code") {
      const marker = body.match(/^\s*(`{3,}|~{3,})/m)?.[1];
      return !!marker && !new RegExp(`\\n {0,3}${marker[0]}{${marker.length},}\\s*$`).test(body);
    }
    return false;
  });
  return contentFragmentSchema.parse({ schema: "liteasy.content-fragment/v1",
    binding: revision ? { kind: "pinned", path, revision, scopeId } : { kind: "legacy-unpinned", reason: "来源未提供可固定版本" },
    representationId: `${path}:text/v1`, profile,
    exactSelection: { text: selected, ranges: [exact] },
    viewContext: { text: overBudget ? selected : view, ranges: overBudget ? [exact] : ranges,
      expansion: overBudget || !expanded ? "none" : definitions.length ? "dependency-closure" : "enclosing-block",
      materialBeyondSelection: !overBudget && expanded },
    integrity: overBudget ? "budget-exceeded" : incomplete ? "incomplete-snapshot" : exact.start === 0 && exact.end === text.length ? "complete" : "structured-partial",
    mapping: "exact-utf16", warnings: overBudget ? ["budget_exceeded"] : incomplete ? ["format_incomplete"] : [],
  });
}
