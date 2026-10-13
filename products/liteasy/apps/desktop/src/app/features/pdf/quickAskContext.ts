import type { QuickAskContextPart, QuickAskSource, QuickAskSpan } from "../../../../../../packages/reading-core/src/quickAsk";
import { contentBlocks } from "../markdown/contentStructure";

export type PreparePdfQuickAskContextInput = { source: QuickAskSource; pageCount: number; sourcePages: number[]; excerpt: string; readPage(page: number): Promise<string>; signal: AbortSignal };
const pageCache = new Map<string, Promise<string>>();
const maximumCachedPages = 96;
const maximumSearchPages = 32;
function subscribe<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("已取消", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", abort); if (!signal.aborted) resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}
export function clearQuickAskContextCache() { pageCache.clear(); }
function cachedPage(input: PreparePdfQuickAskContextInput, page: number) {
  if (input.source.documentRevision === "unresolved") return subscribe(input.readPage(page), input.signal);
  const key = JSON.stringify([input.source.scopeId, input.source.paperId, input.source.documentRevision, input.source.extractorRevision, page]);
  let pending = pageCache.get(key);
  if (!pending) {
    pending = input.readPage(page).then(text => { if (typeof text !== "string" || text.length > 200000) throw new Error("页面文本超出读取上限"); return text; });
    pageCache.set(key, pending);
    pending.catch(() => { if (pageCache.get(key) === pending) pageCache.delete(key); });
    while (pageCache.size > maximumCachedPages) pageCache.delete(pageCache.keys().next().value!);
  } else { pageCache.delete(key); pageCache.set(key, pending); }
  return subscribe(pending, input.signal);
}
/** Bounded deterministic PDF extraction; never substitutes opening pages for sections. */
export async function preparePdfQuickAskContext(input: PreparePdfQuickAskContextInput): Promise<QuickAskContextPart[]> {
  input.signal.throwIfAborted();
  if (!Number.isInteger(input.pageCount) || input.pageCount < 1 || input.sourcePages.some(page => !Number.isInteger(page) || page < 1 || page > input.pageCount)) throw new Error("选区页码无效");
  const texts = new Map<number, string>();
  const failed = new Set<number>();
  async function read(page: number) {
    if (texts.has(page) || failed.has(page)) return;
    try { texts.set(page, await cachedPage(input, page)); }
    catch (error) { input.signal.throwIfAborted(); failed.add(page); }
  }
  for (const page of [...new Set(input.sourcePages)]) await read(page);
  let searched = 0;
  let bytes = 0;
  for (let page = 1; page <= Math.min(input.pageCount, maximumSearchPages); page++) {
    input.signal.throwIfAborted();
    await read(page); searched = page; bytes += texts.get(page)?.length ?? 0;
    if (bytes > 500000) break;
  }
  const parts: QuickAskContextPart[] = [...new Set(input.sourcePages)].map(page => ({ roles: ["page"], text: texts.get(page) ?? "", spans: [{ page, startUtf16: 0, endUtf16: (texts.get(page) ?? "").length, precision: "range" }], status: failed.has(page) ? "unreadable" : texts.get(page)?.trim() ? "available" : "unreadable", complete: !failed.has(page), extraction: "pdf-page-text", ...(!texts.get(page)?.trim() ? { reason: "该页无可用文本；未自动执行 OCR，仍可使用选段。" } : {}) }));
  const searchedAll = searched === input.pageCount && failed.size === 0;
  for (const role of ["abstract", "introduction"] as const) {
    const startPattern = role === "abstract" ? /(?:^|\n)\s*(?:abstract|摘\s*要)\s*[:：.—-]?\s*/im : /(?:^|\n)\s*(?:1[.．]?\s+|I[.．]?\s+)?(?:introduction|引言|绪论)\s*[:：.—-]?\s*/im;
    const endPattern = role === "abstract" ? /(?:^|\n)\s*(?:(?:\d+[.．]?\s+)?(?:introduction|keywords|index terms|引言|绪论|关键词)|\d+[.．]?\s+[A-Z][^\n]{0,100}(?:\n|$))/im : /(?:^|\n)\s*(?:[2-9]\d*[.．]?\s+[^\n]{1,100}|II[IVX]*[.．]?\s+[^\n]{1,100}|(?:related work|background|methods?|methodology|conclusions?|相关工作|背景|方法|结论)\s*)\s*(?:\n|$)/im;
    let found = false; let ended = false; const slices: QuickAskContextPart[] = [];
    for (let page = 1; page <= searched; page++) {
      if (!texts.has(page)) { if (found) break; continue; }
      const text = texts.get(page)!;
      const start = found ? 0 : startPattern.exec(text);
      if (start === null) continue;
      let offset = typeof start === "number" ? start : start.index + start[0].length;
      found = true;
      const rest = text.slice(offset); const end = endPattern.exec(rest);
      const raw = end ? rest.slice(0, end.index) : rest;
      const leading = raw.length - raw.trimStart().length; offset += leading;
      const value = raw.trim();
      if (value) slices.push({ roles: [role], text: value, spans: [{ page, startUtf16: offset, endUtf16: offset + value.length, precision: "range" }], status: "available", complete: true, extraction: "pdf-section-heading" });
      if (end) { ended = true; break; }
    }
    if (found && slices.length) parts.push(...slices.map(part => ({ ...part, status: ended ? "available" as const : "partial" as const, complete: ended, ...(!ended ? { reason: "未确认下一同级节边界，仅提供已读取部分。" } : {}) })));
    else parts.push({ roles: [role], text: "", spans: [], status: searchedAll ? "not_found" : "not_ready", complete: false, extraction: "pdf-section-heading", reason: searchedAll ? "已检查文本，未识别到该节标题。" : `仅检查前 ${searched} 页，尚未确认该节。` });
  }
  return parts;
}

/** Whole Markdown structures only, with definitions kept together. */
export function quickAskStructuralParts(part: QuickAskContextPart): QuickAskContextPart[] {
  if (!part.text || part.spans.length !== 1 || part.spans[0].startUtf16 === undefined) return [part];
  const blocks = contentBlocks(part.text);
  if (blocks.some(block => ["definition", "footnoteDefinition"].includes(block.type))) return [part];
  const span = part.spans[0];
  return blocks.map(block => ({ ...part, text: part.text.slice(block.start, block.end), spans: [{ ...span, startUtf16: span.startUtf16! + block.start, endUtf16: span.startUtf16! + block.end }] }));
}
export function sameQuickAskRange(a: QuickAskSpan, b: QuickAskSpan) { return a.page === b.page && a.precision === "range" && b.precision === "range" && a.startUtf16 === b.startUtf16 && a.endUtf16 === b.endUtf16; }
