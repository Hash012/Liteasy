import { buildPdfChunksFromPages } from "../app/features/import/pdfTextExtractor";

test("turns every extracted PDF page into overlapping evidence chunks with technical terms", () => {
  const chunks = buildPdfChunksFromPages(
    { id: "paper-1", title: "ColBERT Retrieval" },
    [
      {
        page: 2,
        text: [
          "2 Method",
          "ColBERT independently encodes contextualized query and document token vectors.",
          "MaxSim performs late interaction during retrieval. ".repeat(24)
        ].join("\n\n")
      },
      {
        page: 7,
        text: "Experiments report MRR and Recall on MS MARCO."
      }
    ],
    { maxChunkCharacters: 600, overlapCharacters: 60 }
  );

  expect(chunks.length).toBeGreaterThan(2);
  expect(new Set(chunks.map((chunk) => chunk.page))).toEqual(new Set([2, 7]));
  expect(chunks[0]).toMatchObject({
    paperId: "paper-1",
    paperTitle: "ColBERT Retrieval"
  });
  expect(chunks.flatMap((chunk) => chunk.tags)).toContain("ColBERT");
  expect(chunks.flatMap((chunk) => chunk.tags)).toContain("MaxSim");
  expect(chunks.every((chunk) => chunk.snippet.length <= 600)).toBe(true);
});

test("keeps short pages intact and records page provenance", () => {
  const chunks = buildPdfChunksFromPages(
    { id: "paper-2", title: "ACORN" },
    [{ page: 4, text: "ACORN uses predicate-agnostic graph traversal." }]
  );

  expect(chunks).toEqual([
    expect.objectContaining({
      page: 4,
      snippet: "ACORN uses predicate-agnostic graph traversal."
    })
  ]);
});
