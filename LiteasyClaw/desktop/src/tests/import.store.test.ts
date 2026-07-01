import { createImportStore } from "../app/features/import/import.store";

test("marks import status as parsed after successful parse job", () => {
  const store = createImportStore();
  const jobId = store.startImport({
    documentId: "paper-a",
    sourcePath: "fixtures/paper-a.pdf"
  });

  store.markParsed(jobId, { paperId: "paper-a" });

  expect(store.getJob(jobId)?.status).toBe("parsed");
  expect(store.getJob(jobId)?.paperId).toBe("paper-a");
});

test("keeps import status attached to the selected document row", () => {
  const store = createImportStore();
  const firstJobId = store.startImport({
    documentId: "paper-a",
    sourcePath: "fixtures/paper-a.pdf"
  });
  store.startImport({
    documentId: "paper-b",
    sourcePath: "fixtures/paper-b.pdf"
  });

  expect(store.getJob(firstJobId)?.documentId).toBe("paper-a");
  expect(store.getLatestJobByDocumentId("paper-a")?.id).toBe(firstJobId);
});

test("stores parsed retrieval chunks on the imported document", () => {
  const store = createImportStore();
  const jobId = store.startImport({
    documentId: "paper-a",
    sourcePath: "fixtures/paper-a.pdf"
  });

  store.markParsed(jobId, {
    paperId: "paper-a",
    chunks: [
      {
        page: 2,
        paperId: "paper-a",
        paperTitle: "Paper A",
        snippet: "paper-a snippet",
        summary: "paper-a summary",
        tags: ["方法"]
      }
    ]
  });

  expect(store.getJob(jobId)?.parsedChunks?.[0]?.snippet).toBe("paper-a snippet");
  expect(store.getParsedChunksByDocumentId("paper-a")?.[0]?.page).toBe(2);
});
