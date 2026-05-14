import { createImportStore } from "../app/features/import/import.store";

test("marks import status as parsed after successful parse job", () => {
  const store = createImportStore();
  const jobId = store.startImport("fixtures/paper-a.pdf");

  store.markParsed(jobId, {
    paperId: "paper-a",
    title: "Test Paper",
    content: "Extracted text content",
    pageCount: 5,
  });

  expect(store.getJob(jobId)?.status).toBe("parsed");
  expect(store.getJob(jobId)?.paperId).toBe("paper-a");
});

test("marks import as failed with error message", () => {
  const store = createImportStore();
  const jobId = store.startImport("bad-file.pdf");

  store.markFailed(jobId, "File not found");

  expect(store.getJob(jobId)?.status).toBe("failed");
  expect(store.getJob(jobId)?.error).toBe("File not found");
});
