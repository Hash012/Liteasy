import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalLibraryPdfError, readLocalLibraryPdfForBrowser } from "./localLibraryPdf.mjs";

test("reads a PDF only when it is contained in the local library root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liteasy-library-"));
  const papers = path.join(root, "papers");
  await mkdir(papers);
  const pdfPath = path.join(papers, "paper.pdf");
  await writeFile(pdfPath, Buffer.from("%PDF-1.7\n"));

  const bytes = await readLocalLibraryPdfForBrowser(pdfPath, { rootPath: root });
  assert.equal(bytes.toString("ascii"), "%PDF-1.7\n");
  await assert.rejects(
    readLocalLibraryPdfForBrowser("/tmp/not-in-library.pdf", { rootPath: root }),
    LocalLibraryPdfError
  );
});
