import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";
import { extractPdfIndexForPaper } from "../app/features/import/pdfTextExtractor";
import { fileWorkflowTestPaper } from "./fixtures/fileWorkflowTestFixture";

const fixturePath = resolve(
  process.cwd(),
  "../../../../development/test-data/file-workflow-test/larimar-episodic-memory.pdf"
);

test("registers the branch PDF with stable identity and extractable full text", async () => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(resolve(
    process.cwd(),
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
  )).href;
  const bytes = await readFile(fixturePath);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    fileWorkflowTestPaper.contentHash
  );

  const result = await extractPdfIndexForPaper(
    {
      contentHash: fileWorkflowTestPaper.contentHash,
      id: fileWorkflowTestPaper.id,
      sourcePath: fileWorkflowTestPaper.publicPath,
      title: fileWorkflowTestPaper.title
    },
    {
      loadPdfSource: async () => new Uint8Array(bytes),
      ocrLanguage: "eng"
    }
  );

  expect(result.pages).toHaveLength(18);
  expect(result.chunks.length).toBeGreaterThan(40);
  expect(result.chunks.every((chunk) => chunk.paperId === fileWorkflowTestPaper.id)).toBe(true);
  expect(result.chunks.map((chunk) => chunk.snippet).join("\n")).toContain(
    "Large Language Models with Episodic Memory Control"
  );
}, 30_000);
