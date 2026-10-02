// Development-only harness. Imported only by its standalone test HTML, never App.
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import worker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { PdfThumbnail } from "../../app/features/pdf/PdfThumbnail";
pdfjs.GlobalWorkerOptions.workerSrc = worker;

function documentBytes(count: number) {
  const content = "BT /F1 18 Tf 40 240 Td (Synthetic thumbnail lifecycle fixture.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, index) => `${index + 5} 0 R`).join(" ")}] /Count ${count} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ...Array.from({ length: count }, () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>"),
  ];
  let source = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => { const offset = source.length; source += `${index + 1} 0 obj\n${object}\nendobj\n`; return offset; });
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(source);
}

const container = document.getElementById("fixture")!;
const root = createRoot(container);
const quantile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const fixture = {
  async run(count = 50) {
    const started = performance.now();
    const bytes = documentBytes(count);
    const byteLength = bytes.byteLength;
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    const loadMs = performance.now() - started;
    const pages: pdfjs.PDFPageProxy[] = [];
    const times: number[] = [];
    let closedCanvasPixels = 0;
    let maximumCanvasPixels = 0;
    try {
      for (let index = 1; index <= count; index++) {
        let done!: () => void;
        let failed!: (error: unknown) => void;
        const rendered = new Promise<void>((resolve, reject) => { done = resolve; failed = reject; });
        const measured = {
          async getPage(pageNumber: number) {
            const page = await pdf.getPage(pageNumber);
            pages.push(page);
            return {
              getViewport: page.getViewport.bind(page),
              cleanup: page.cleanup.bind(page),
              render(...args: Parameters<typeof page.render>) {
                const task = page.render(...args);
                void task.promise.then(done, failed);
                return task;
              },
            };
          },
        } as unknown as pdfjs.PDFDocumentProxy;
        const renderStarted = performance.now();
        flushSync(() => root.render(<PdfThumbnail key={index} active={false} annotations={[]} onNavigate={() => {}} pageNumber={index} pdfDocument={measured} />));
        await rendered;
        times.push(performance.now() - renderStarted);
        const canvas = container.querySelector("canvas")!;
        maximumCanvasPixels = Math.max(maximumCanvasPixels, canvas.width * canvas.height);
        flushSync(() => root.render(null));
        closedCanvasPixels += canvas.width * canvas.height;
      }
      // Inspect PDF.js's real retained page operator states, not heap estimates.
      const states = pages.flatMap((page) => [...(page as unknown as { _intentStates: Map<string, { operatorList: { fnArray: number[] } }> })._intentStates.values()]);
      return {
        fixture: "synthetic-50-page-text-pdf-v1", pages: count, byteLength, loadMs,
        firstThumbnailMs: times[0], warmThumbnailP50Ms: quantile(times.slice(1), .5), warmThumbnailP95Ms: quantile(times.slice(1), .95),
        remainingOperatorLists: states.length, remainingOperators: states.reduce((sum, state) => sum + state.operatorList.fnArray.length, 0),
        maximumCanvasPixels, closedCanvasPixels, rawThumbnailMs: times,
      };
    } finally { flushSync(() => root.render(null)); await loadingTask.destroy(); }
  },
};
Object.assign(window, { pdfLifecycleFixture: fixture });
