import type { SearchMetadata } from "../search/searchQuery";
export const searchGroups = { metadata: "文件与元信息", body: "正文", note: "笔记", annotation: "批注", artifact: "产物" } as const;
export type SearchGroup = keyof typeof searchGroups;
export type SearchLocator = { path: string; readingId?: string; paperId?: string; page?: number; annotationId?: string; line?: number; quote?: string };
export type SearchSection = { key: string; group: SearchGroup; text: string; metadata?: SearchMetadata; locator: SearchLocator };
export type SearchDocument = {
  id: string; title: string; revision: string; metadata?: SearchMetadata; sections: SearchSection[];
  coverage: "indexed" | "partial" | "metadata" | "failed"; detail?: string;
};
export type SearchHit = SearchLocator & { id: string; documentId: string; revision: string; title: string; group: SearchGroup; snippet: string; text: string; matchedText?: string; metadata?: SearchMetadata };
export type SearchCoverage = { indexed: number; partial: number; metadata: number; failed: number; limited: boolean; details: Array<{ title: string; detail: string }> };
export type SearchCorpus = { documents: SearchDocument[]; limited: boolean };
export interface SearchSource {
  collect(signal: AbortSignal, progress: (count: number) => void): Promise<SearchCorpus>;
  verify(hit: SearchHit, signal: AbortSignal): Promise<boolean>;
  verifyMany?(hits: SearchHit[], signal: AbortSignal): Promise<boolean[]>;
}
