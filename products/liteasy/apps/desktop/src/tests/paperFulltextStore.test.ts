import {
  buildPaperFulltextSnapshot,
  findPagesWithoutTextLayer,
  mergePaperPageTexts,
  normalizePaperFulltext,
  paperFulltextPagesToRecord,
  paperPageTextRecordToPages,
  samePaperPageTexts
} from "../app/features/pdf/paperFulltextStore";

test("reads back a stored snapshot with pages in order", () => {
  const stored = normalizePaperFulltext({
    extraction: "pdf_text_layer",
    extractedAt: "2026-07-31T00:00:00.000Z",
    pages: [
      { page: 3, text: "third" },
      { page: 1, text: "first" }
    ],
    version: 1
  });

  expect(stored?.pages).toEqual([
    { page: 1, text: "first", textExtraction: "embedded" },
    { page: 3, text: "third", textExtraction: "embedded" }
  ]);
  expect(stored?.parser).toBe("local_pdfjs");
  expect(stored?.version).toBe(2);
  expect(stored?.extractedAt).toBe("2026-07-31T00:00:00.000Z");
});

test("drops malformed pages instead of trusting them for positioning", () => {
  const stored = normalizePaperFulltext({
    pages: [
      { page: 1, text: "kept" },
      { page: 0, text: "page numbers start at one" },
      { page: 2.5, text: "not an integer" },
      { page: 3 },
      "nonsense"
    ]
  });

  expect(stored?.pages).toEqual([{ page: 1, text: "kept", textExtraction: "embedded" }]);
});

test("rejects anything that is not a snapshot", () => {
  expect(normalizePaperFulltext(null)).toBeUndefined();
  expect(normalizePaperFulltext([])).toBeUndefined();
  expect(normalizePaperFulltext({ pages: "all of them" })).toBeUndefined();
});

test("a partial read does not shrink a complete stored record", () => {
  const stored = { 1: "first", 2: "second", 3: "third" };
  // The reader has only rendered page 2 this session.
  const inMemory = { 2: "second" };

  expect(mergePaperPageTexts(stored, inMemory)).toEqual(stored);
});

test("freshly rendered text wins over what was stored for the same page", () => {
  const merged = mergePaperPageTexts({ 1: "stale" }, { 1: "current" });

  expect(merged).toEqual({ 1: "current" });
});

test("an empty live text layer does not erase stored OCR text", () => {
  expect(mergePaperPageTexts({ 1: "stable OCR text" }, { 1: "" }))
    .toEqual({ 1: "stable OCR text" });
});

test("detects whether a merge actually added anything, so it does not rewrite on every render", () => {
  const stored = { 1: "first", 2: "second" };

  expect(samePaperPageTexts(stored, { 1: "first", 2: "second" })).toBe(true);
  expect(samePaperPageTexts(stored, { 1: "first" })).toBe(false);
  expect(samePaperPageTexts(stored, { 1: "first", 2: "changed" })).toBe(false);
  expect(samePaperPageTexts({}, {})).toBe(true);
});

test("round-trips between the reader's page map and the stored page list", () => {
  const record = { 1: "first", 2: "second" };
  const pages = paperPageTextRecordToPages(record);

  expect(pages).toEqual([
    { page: 1, text: "first" },
    { page: 2, text: "second" }
  ]);
  expect(paperFulltextPagesToRecord(pages)).toEqual(record);
});

test("records parser and per-page extraction provenance", () => {
  const snapshot = buildPaperFulltextSnapshot({
    extractedAt: "2026-07-31T00:00:00.000Z",
    pageTextExtractions: { 1: "embedded", 2: "ocr" },
    pageTexts: { 2: "second", 1: "first" }
  });

  expect(snapshot.parser).toBe("local_pdfjs");
  expect(snapshot.version).toBe(2);
  expect(snapshot.pages.map((page) => page.page)).toEqual([1, 2]);
  expect(snapshot.pages[1]).toEqual({ page: 2, text: "second", textExtraction: "ocr" });
});

test("names the pages that rendered without any text layer", () => {
  // The real case this came from: a scanned CNKI paper whose first page carried only a DOI
  // stamp and whose body pages were empty, so the layer showed nothing and explained nothing.
  const gaps = findPagesWithoutTextLayer({ 1: "DOI：10．13495", 2: "", 3: "   ", 4: "正文" });

  expect(gaps.pages).toEqual([2, 3]);
  expect(gaps.documentHasNoTextLayer).toBe(false);
});

test("calls the whole document text-free only when every rendered page is", () => {
  expect(findPagesWithoutTextLayer({ 1: "", 2: "" }).documentHasNoTextLayer).toBe(true);
  expect(findPagesWithoutTextLayer({ 1: "", 2: "有正文" }).documentHasNoTextLayer).toBe(false);
});

test("an unrendered document is unknown, not text-free", () => {
  // Nothing has rendered yet. Reporting a scan here would accuse every document of being one
  // for as long as it took the first page to appear.
  expect(findPagesWithoutTextLayer({})).toEqual({ documentHasNoTextLayer: false, pages: [] });
});

test("archive revisions use native-compatible bare hashes and ignore collection timestamps", async () => {
  const { webcrypto, createHash } = await import("node:crypto");
  const { paperFulltextRevision } = await import("../app/features/pdf/paperFulltextStore");
  const { canonicalResourceJson } = await import("../app/features/resource-filesystem/resourceFileContent");
  const original = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  try {
    const snapshot = buildPaperFulltextSnapshot({ extractedAt: "2026-10-15", pageTexts: { 1: "old OCR offsets" }, pageTextExtractions: { 1: "ocr" } });
    const revision = await paperFulltextRevision(snapshot);
    expect(revision).toMatch(/^[a-f0-9]{64}$/);
    expect(revision).toBe(createHash("sha256").update(canonicalResourceJson({ pages: snapshot.pages, parser: snapshot.parser, sourceHash: null, recipe: null })).digest("hex"));
    expect(await paperFulltextRevision({ ...snapshot, extractedAt: "later" })).toBe(revision);
  } finally { Object.defineProperty(globalThis, "crypto", { value: original, configurable: true }); }
});
