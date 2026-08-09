import {
  buildCachedReaderPaper,
  contentPaperId,
  findCachedReaderPaperBySourceId,
  isCachedSourcePath,
  removeCachedReaderPaper,
  resolveReaderPaper,
  upsertCachedReaderPaper
} from "../app/features/library/cachedReaderPapers";
import type { Paper } from "../app/features/workspace/workspace.types";

const hash = "A".repeat(64);

function cachedPaper(overrides: { contentHash?: string; title?: string } = {}) {
  return buildCachedReaderPaper({
    cachePath: `C:/cache/paper-cache/${(overrides.contentHash ?? hash).toLowerCase()}.pdf`,
    contentHash: overrides.contentHash ?? hash,
    title: overrides.title ?? "Attention is all you need"
  });
}

test("identifies a cached paper by its content fingerprint", () => {
  const paper = cachedPaper();

  expect(paper.id).toBe(contentPaperId(hash));
  // Must match content_paper_id in src-tauri/src/local_library.rs, or promotion would
  // change the paper's id and orphan its annotations.
  expect(paper.id).toBe(`paper-${hash.toLowerCase()}`);
  expect(paper.sourcePath).toBe(paper.cachePath);
});

test("a promoted paper keeps its id, so the open tab switches to the library copy", () => {
  const cached = cachedPaper();
  // Promotion moves the body; the library then reports the same id back.
  const promoted: Paper = {
    id: contentPaperId(hash),
    sourcePath: "C:/library/papers/Attention is all you need.pdf",
    title: "Attention is all you need"
  };

  const resolved = resolveReaderPaper({
    cachedPapers: [cached],
    libraryPapers: [promoted],
    paperId: cached.id
  });

  expect(resolved).toBe(promoted);
  expect(resolved?.id).toBe(cached.id);
});

test("reopening the same paper reuses one entry instead of stacking tabs", () => {
  const first = cachedPaper();
  const reopened = cachedPaper({ title: "Attention is all you need (v2)" });

  const papers = upsertCachedReaderPaper(upsertCachedReaderPaper([], first), reopened);

  expect(papers).toHaveLength(1);
  expect(papers[0].title).toBe("Attention is all you need (v2)");
});

test("keeps distinct papers apart and drops them individually", () => {
  const one = cachedPaper();
  const two = cachedPaper({ contentHash: "b".repeat(64), title: "BERT" });

  const papers = upsertCachedReaderPaper(upsertCachedReaderPaper([], one), two);
  expect(papers).toHaveLength(2);

  const remaining = removeCachedReaderPaper(papers, one.id);
  expect(remaining.map((paper) => paper.title)).toEqual(["BERT"]);
});

test("resolves reader tabs against the library first, then the cache", () => {
  const cached = cachedPaper();
  const libraryPaper: Paper = { id: "local-1-0", sourcePath: "C:/library/papers/a.pdf", title: "A" };

  expect(
    resolveReaderPaper({ cachedPapers: [cached], libraryPapers: [libraryPaper], paperId: cached.id })
  ).toBe(cached);
  expect(
    resolveReaderPaper({ cachedPapers: [cached], libraryPapers: [libraryPaper], paperId: "local-1-0" })
  ).toBe(libraryPaper);
  expect(
    resolveReaderPaper({ cachedPapers: [cached], libraryPapers: [libraryPaper], paperId: "missing" })
  ).toBeNull();
});

test("routes only cache-backed paths to the cache loader", () => {
  const cached = cachedPaper();

  expect(isCachedSourcePath([cached], cached.cachePath)).toBe(true);
  expect(isCachedSourcePath([cached], "C:/library/papers/a.pdf")).toBe(false);
  expect(isCachedSourcePath([], cached.cachePath)).toBe(false);
});

test("finds an already-cached body by its retrieval source, so a drag skips re-downloading", () => {
  const cached = buildCachedReaderPaper({
    cachePath: "C:/cache/paper-cache/abc.pdf",
    contentHash: hash,
    sourceId: "openalex:W123",
    title: "Attention is all you need"
  });

  expect(findCachedReaderPaperBySourceId([cached], "openalex:W123")).toBe(cached);
  expect(findCachedReaderPaperBySourceId([cached], "openalex:W999")).toBeNull();
  // A body cached without a known source must not match a blank lookup.
  expect(findCachedReaderPaperBySourceId([cachedPaper()], "")).toBeNull();
});

test("falls back to a readable title when the source has none", () => {
  expect(cachedPaper({ title: "   " }).title).toBe("未命名论文");
});

test("preserves the explicit cloud library reference on a cached reader paper", () => {
  const paper = buildCachedReaderPaper({
    cachePath: "C:/cache/paper-cache/cloud.pdf",
    contentHash: hash,
    libraryReference: {
      documentId: "document-1",
      revision: 7,
      scopeId: "organization-1",
      scopeType: "organization"
    },
    title: "Cloud paper"
  });

  expect(paper.libraryReference).toEqual({
    documentId: "document-1",
    revision: 7,
    scopeId: "organization-1",
    scopeType: "organization"
  });
});
