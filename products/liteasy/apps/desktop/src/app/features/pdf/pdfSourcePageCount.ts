import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
/** Explicit full-text additions validate page coverage against the original PDF. */
export async function originalPdfPageCount(bytes: Uint8Array) {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try { return (await task.promise).numPages; }
  finally { await task.destroy(); }
}
