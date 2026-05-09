import { createImportStore } from "../app/features/import/import.store";

test("marks import status as parsed after successful parse job", () => {
  const store = createImportStore();
  const jobId = store.startImport("fixtures/paper-a.pdf");

  store.markParsed(jobId, { paperId: "paper-a" });

  expect(store.getJob(jobId)?.status).toBe("parsed");
  expect(store.getJob(jobId)?.paperId).toBe("paper-a");
});
