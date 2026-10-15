import { researchMarkdownParser } from "./researchParser";
import { contentFragmentSchema, type ContentFragment } from "./contentFragment";

const parser = researchMarkdownParser();
export type ContentBlock = { start: number; end: number; type: string; atomic: boolean };
/** Source positions always refer to original UTF-16, before CRLF/math/render normalization. */
export function contentBlocks(text: string): ContentBlock[] {
  // Avoid constructing an unbounded AST for a giant source just to read a small window.
  if (text.length > 2_000_000) return [{ start: 0, end: text.length, type: "source-budget", atomic: true }];
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
  let cursor = 0;
  const segments = ranges.map((sourceRange, index) => {
    const outputStart = cursor; cursor += sourceRange.end - sourceRange.start;
    const outputEnd = cursor; if (index < ranges.length - 1) cursor += 2;
    return { outputStart, outputEnd, sourceRange };
  });
  const view = ranges.map(range => text.slice(range.start, range.end)).join("\n\n");
  const overBudget = view.length > Math.min(200000, input.maxViewCharacters ?? 80000);
  const previewRange = safeUtf16Range(text, exact.start, Math.min(exact.end, exact.start + 200000));
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
    representationId: `${path}:text/v1`, profile, sourceLine: text.slice(0, exact.start).split("\n").length,
    exactSelection: { text: selected, ranges: [exact] },
    viewContext: { text: overBudget ? text.slice(previewRange.start, previewRange.end) : view, ranges: overBudget ? [previewRange] : ranges,
      segments: overBudget ? [{ outputStart: 0, outputEnd: previewRange.end - previewRange.start, sourceRange: previewRange }] : segments,
      expansion: overBudget || !expanded ? "none" : definitions.length ? "dependency-closure" : "enclosing-block",
      materialBeyondSelection: !overBudget && expanded },
    integrity: overBudget ? "budget-exceeded" : incomplete ? "incomplete-snapshot" : exact.start === 0 && exact.end === text.length ? "complete" : "structured-partial",
    mapping: "exact-utf16", warnings: overBudget ? ["budget_exceeded"] : incomplete ? ["format_incomplete"] : [],
  });
}

/** Subselect an existing bound fragment without reassigning its representation or original offsets. */
export function selectContentRange(content: ContentFragment, start: number, end: number): ContentFragment {
  const exact = content.exactSelection.ranges;
  const segments = content.viewContext.segments;
  if (exact.length !== 1 || !segments?.length || content.mapping !== "exact-utf16") throw new Error("此预览包含多个来源片段，请打开原文件选择。");
  const absoluteStart = exact[0].start + start, absoluteEnd = exact[0].start + end;
  const segment = segments.find(segment => absoluteStart >= segment.sourceRange.start && absoluteEnd <= segment.sourceRange.end);
  if (!segment) throw new Error("选区不在已读取的来源范围内，请重新载入。");
  const offset = segment.sourceRange.start - segment.outputStart;
  const selected = sourceContent({ text: content.viewContext.text, path: content.binding.kind === "pinned" ? content.binding.path : "liteasy://legacy/fragment",
    scopeId: content.binding.kind === "pinned" ? content.binding.scopeId : "legacy", profile: content.profile,
    start: absoluteStart - offset, end: absoluteEnd - offset });
  const remap = (range: { start: number; end: number; unit: "utf16" }) => {
    const source = segments.find(segment => range.start >= segment.outputStart && range.end <= segment.outputEnd);
    if (!source) throw new Error("选区跨越不连续来源，请打开原文件选择。");
    const delta = source.sourceRange.start - source.outputStart;
    return { ...range, start: range.start + delta, end: range.end + delta };
  };
  return { ...selected, binding: content.binding, representationId: content.representationId,
    exactSelection: { ...selected.exactSelection, ranges: selected.exactSelection.ranges.map(remap) },
    viewContext: { ...selected.viewContext, ranges: selected.viewContext.ranges.map(remap), segments: selected.viewContext.segments?.map(segment => ({ ...segment, sourceRange: remap(segment.sourceRange) })) } };
}
