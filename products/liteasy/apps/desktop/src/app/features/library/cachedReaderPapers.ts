import type { Paper } from "../workspace/workspace.types";

/**
 * Deliberately the same scheme the library uses (`content_paper_id` in
 * `src-tauri/src/local_library.rs`). Because both sides derive the id from the body's
 * sha256, promoting a cached paper into the library does not change its id — so its
 * annotations and anchor index stay attached with no migration step.
 */
const paperIdPrefix = "paper-";

/**
 * A paper whose body sits in the disposable cache rather than the library. It can be
 * read and annotated, but it deliberately stays out of the library listing until the
 * reader promotes it.
 */
export type CachedReaderPaper = Paper & {
  cachePath: string;
  contentHash: string;
  /** The retrieval result this body came from, so a later drag can promote the file
   *  already on disk instead of downloading it a second time. */
  sourceId?: string;
};

/** Derived from the content fingerprint, so the same paper reached from two different
 *  anchors resolves to one reader tab and one set of annotations. */
export function contentPaperId(contentHash: string) {
  return `${paperIdPrefix}${contentHash.trim().toLowerCase()}`;
}

export function buildCachedReaderPaper(input: {
  cachePath: string;
  contentHash: string;
  libraryReference?: Paper["libraryReference"];
  literature?: Paper["literature"];
  sourceId?: string;
  title: string;
}): CachedReaderPaper {
  return {
    cachePath: input.cachePath,
    contentHash: input.contentHash.trim().toLowerCase(),
    id: contentPaperId(input.contentHash),
    libraryReference: input.libraryReference,
    literature: input.literature,
    sourceId: input.sourceId,
    sourcePath: input.cachePath,
    title: input.title.trim() || "未命名论文"
  };
}

export function findCachedReaderPaperBySourceId(
  papers: readonly CachedReaderPaper[],
  sourceId: string
): CachedReaderPaper | null {
  return papers.find((candidate) => candidate.sourceId === sourceId) ?? null;
}

/** Keeps one entry per fingerprint so reopening the same paper does not stack up tabs. */
export function upsertCachedReaderPaper(
  papers: readonly CachedReaderPaper[],
  paper: CachedReaderPaper
): CachedReaderPaper[] {
  const others = papers.filter((candidate) => candidate.id !== paper.id);
  return [...others, paper];
}

export function removeCachedReaderPaper(
  papers: readonly CachedReaderPaper[],
  paperId: string
): CachedReaderPaper[] {
  return papers.filter((candidate) => candidate.id !== paperId);
}

export function findCachedReaderPaper(
  papers: readonly CachedReaderPaper[],
  paperId: string | null | undefined
): CachedReaderPaper | null {
  if (!paperId) {
    return null;
  }
  return papers.find((candidate) => candidate.id === paperId) ?? null;
}

/**
 * Reader tabs may point at either a library paper or a cached one. The library wins on
 * id collision, which is also how promotion takes effect: once the promoted body shows
 * up in the library snapshot under the same id, the open tab silently switches over to
 * it without closing or reloading.
 */
export function resolveReaderPaper(input: {
  cachedPapers: readonly CachedReaderPaper[];
  libraryPapers: readonly Paper[];
  paperId: string;
}): Paper | null {
  return input.libraryPapers.find((candidate) => candidate.id === input.paperId) ??
    findCachedReaderPaper(input.cachedPapers, input.paperId);
}

/** The reader must load a cached body through the cache command, not the library one,
 *  because the library guard rejects paths outside its root. */
export function isCachedSourcePath(
  papers: readonly CachedReaderPaper[],
  sourcePath: string
) {
  return papers.some((candidate) => candidate.cachePath === sourcePath);
}
