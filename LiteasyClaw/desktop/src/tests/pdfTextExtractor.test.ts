import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { vi } from "vitest";
import { buildPdfChunksFromPages, extractPdfPages } from "../app/features/import/pdfTextExtractor";

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
  expect(chunks.every((chunk) => (
    typeof chunk.pageTextStart === "number" &&
    typeof chunk.pageTextEnd === "number" &&
    chunk.pageTextEnd - chunk.pageTextStart === chunk.snippet.replace(/\s+/g, " ").trim().length
  ))).toBe(true);
});

test("records offsets in the whitespace-folded coordinate system used by the PDF text layer", () => {
  const [chunk] = buildPdfChunksFromPages(
    { id: "paper-3", title: "Whitespace test" },
    [{ page: 1, text: "Opening text.\n\nEvidence starts here." }]
  );

  expect(chunk).toMatchObject({
    pageTextEnd: "Opening text. Evidence starts here.".length,
    pageTextStart: 0
  });
});

test("records offsets in the same Unicode-normalized coordinate system as PDF evidence highlighting", () => {
  const [chunk] = buildPdfChunksFromPages(
    { id: "paper-unicode", title: "Unicode coordinate test" },
    [{ page: 1, text: "Prefix. Multi\u00ad\nmodal uses full-width \uFF21I tokens." }]
  );

  expect(chunk).toMatchObject({
    pageTextEnd: "prefix. multimodal uses full-width ai tokens.".length,
    pageTextStart: 0,
    snippet: "Prefix.\n\nMultimodal uses full-width \uFF21I tokens."
  });
});

test("keeps short pages intact and records page provenance", () => {
  const chunks = buildPdfChunksFromPages(
    { id: "paper-2", title: "ACORN" },
    [{ page: 4, text: "ACORN uses predicate-agnostic graph traversal." }]
  );

  expect(chunks).toEqual([
    expect.objectContaining({
      page: 4,
      pageTextEnd: 46,
      pageTextStart: 0,
      snippet: "ACORN uses predicate-agnostic graph traversal."
    })
  ]);
});

test("marks OCR-derived chunks so evidence navigation can remain page-level", () => {
  const [chunk] = buildPdfChunksFromPages(
    { id: "paper-ocr", title: "Scanned paper" },
    [{ page: 3, text: "A scanned page reconstructed through OCR.", textExtraction: "ocr" }]
  );

  expect(chunk).toMatchObject({
    page: 3,
    textExtraction: "ocr"
  });
  expect(chunk.tags).toContain("OCR 识别");
});

test("extracts a no-text PDF through the real OCR fallback and preserves its provenance", async () => {
  const fixturePath = resolve(process.cwd(), "public/papers/liteasy-ocr-scanned-fixture.pdf");
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
    resolve(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")
  ).href;
  const originalCreateElement = document.createElement.bind(document);
  const ownDescriptor = Object.getOwnPropertyDescriptor(document, "createElement");
  Object.defineProperty(document, "createElement", {
    configurable: true,
    value: (tagName: string) => tagName.toLowerCase() === "canvas"
      ? createCanvas(1, 1)
      : originalCreateElement(tagName)
});

  try {
    const recognize = vi.fn(async (canvas: HTMLCanvasElement) => {
      expect(canvas.width).toBeGreaterThan(0);
      expect(canvas.height).toBeGreaterThan(0);
      return { data: { text: "Liteasy scanned evidence\nOCR must preserve this sentence." } };
    });
    const terminate = vi.fn(async () => undefined);
    const pages = await extractPdfPages(new Uint8Array(readFileSync(fixturePath)), {
      createOcrWorker: async (language) => {
        expect(language).toBe("eng");
        return { recognize, terminate };
      }
    });
    expect(pages).toEqual([
      expect.objectContaining({
        page: 1,
        textExtraction: "ocr",
        text: expect.stringContaining("Liteasy scanned evidence")
      })
    ]);
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledTimes(1);
  } finally {
    if (ownDescriptor) {
      Object.defineProperty(document, "createElement", ownDescriptor);
    } else {
      Reflect.deleteProperty(document, "createElement");
    }
  }
}, 120_000);

test("passes the selected OCR language to a scanned PDF worker", async () => {
  const fixturePath = resolve(process.cwd(), "public/papers/liteasy-ocr-scanned-fixture.pdf");
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
    resolve(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")
  ).href;
  const originalCreateElement = document.createElement.bind(document);
  const ownDescriptor = Object.getOwnPropertyDescriptor(document, "createElement");
  Object.defineProperty(document, "createElement", {
    configurable: true,
    value: (tagName: string) => tagName.toLowerCase() === "canvas"
      ? createCanvas(1, 1)
      : originalCreateElement(tagName)
  });
  const createOcrWorker = vi.fn(async () => ({
    recognize: async () => ({ data: { text: "中文扫描证据" } }),
    terminate: async () => undefined
  }));

  try {
    await extractPdfPages(new Uint8Array(readFileSync(fixturePath)), {
      createOcrWorker,
      ocrLanguage: "chi_sim"
    });
    expect(createOcrWorker).toHaveBeenCalledWith("chi_sim");
  } finally {
    if (ownDescriptor) {
      Object.defineProperty(document, "createElement", ownDescriptor);
    } else {
      Reflect.deleteProperty(document, "createElement");
    }
  }
}, 120_000);
