import { contentBlocks } from "../markdown/contentStructure";
import type { ReferenceDocument } from "../resource-links/resourceReferenceService";
import { referenceCharacters } from "../resource-links/referenceText";

export type SourceStructureItem = { id: string; title: string; type: string; start: number; end: number; page?: number; revision?: string; parser: string };
/** Parsed-source UTF-16 positions, never layout/DOM lines or guessed PDF paragraphs. */
export function referenceSourceStructure(document: ReferenceDocument): SourceStructureItem[] {
  const revision = document.asset.revision;
  if (document.source) return document.source.pages.map(page => ({ id: `${revision}:page:${page.page}`, title: `第 ${page.page} 页`, type: "page", start: page.start, end: page.end, page: page.page, revision, parser: "cached-page-text/v1" }));
  if (["paper", "source.document"].includes(document.asset.kind)) return [];
  return contentBlocks(document.text).filter(block => block.type !== "source-budget" && (document.complete || block.end < document.text.length)).map(block => ({
    id: `${revision}:liteasy-research-markdown/v1:${block.type}:${block.start}:${block.end}`,
    title: document.text.slice(block.start, block.end).replace(/\s+/g, " ").slice(0, 90),
    type: block.type, start: block.start, end: block.end, revision, parser: "liteasy-research-markdown/v1",
  }));
}
export function structureSelection(document: ReferenceDocument, item: SourceStructureItem) {
  if (item.revision !== document.asset.revision) throw new Error("解析版本已变化，请重新选择片段。");
  return referenceCharacters(document.text, item.start, item.end, document.complete);
}
