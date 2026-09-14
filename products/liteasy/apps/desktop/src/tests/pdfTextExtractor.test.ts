import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { vi } from "vitest";
import { buildPdfRecognitionRequest, selectPdfRecognitionCandidate } from "../app/features/metadata/pdfRecognition";
import {
  buildPdfChunksFromPages,
  extractPdfChunksForPaper,
  extractPdfPages,
  extractPdfRecognitionEvidence,
  pdfOcrWorkerOptions
} from "../app/features/import/pdfTextExtractor";

pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
  resolve(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")
).href;

test("reads real PDF title-page evidence without extracting the entire document", async () => {
  const evidence = await extractPdfRecognitionEvidence(new Uint8Array(readFileSync(
    resolve(process.cwd(), "src/tests/assets/papers/attention-is-all-you-need-arxiv.pdf")
  )));
  expect(evidence.firstPageText).toMatch(/Attention\s+Is\s+All\s+You\s+Need/i);
  expect(evidence.firstPageText).toContain("Vaswani");
});

test.each([
  ["attention-is-all-you-need-arxiv.pdf", "Attention Is All You Need", "Ashish Vaswani", "1706.03762v7"],
  ["bert-pretraining-arxiv.pdf", "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding", "Jacob Devlin", "1810.04805v2"],
  ["glue-benchmark-arxiv.pdf", "GLUE: A Multi-Task Benchmark and Analysis Platform for Natural Language Understanding", "Alex Wang", "1804.07461v3"],
  ["survey-vector-database-management-systems.pdf", "Survey of Vector Database Management Systems", "James Jie Pan", "2310.14021v1"],
  ["colbert-late-interaction.pdf", "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT", "Omar Khattab", "2004.12832v2"],
  ["acorn-vector-search.pdf", "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data", "Liana Patel", "2403.04871v1"],
  ["squad-100k-questions-arxiv.pdf", "SQuAD: 100,000+ Questions for Machine Comprehension of Text", "Pranav Rajpurkar", "1606.05250v3"],
  ["ancient-languages-semantic-corpus-analysis-arxiv.pdf", "From transcription to semantic corpus analysis: unsupervised learning of sentence representations for ancient languages", "Théotime de la Selle", "2607.24542v1"]
])("extracts the title from %s without copyright banners, authors or affiliations", async (file, title, author, arxivId) => {
  const evidence = await extractPdfRecognitionEvidence(new Uint8Array(readFileSync(resolve(process.cwd(), "src/tests/assets/papers", file))));
  const request = buildPdfRecognitionRequest(evidence);
  const normalize = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  expect(normalize(request?.query ?? "")).toBe(normalize(title));
  expect(request?.hints?.title).toBeTruthy();
  const candidate = { candidateKey: `arxiv:${arxivId}`, provider: "arxiv" as const,
    record: { title, authors: [author], identifiers: [{ kind: "arxiv_id" as const, source: "public_registry" as const, value: arxivId }] } };
  expect(selectPdfRecognitionCandidate({ status: "exact", candidate, confirmationMode: "candidate", unavailableProviders: [] }, evidence)).toBe(candidate);
});

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

test("loads a managed local PDF as bytes before handing it to PDF.js", async () => {
  const fixturePath = resolve(process.cwd(), "src/tests/assets/papers/colbert-late-interaction.pdf");
  const loadPdfSource = vi.fn(async () => new Uint8Array(readFileSync(fixturePath)));

  const chunks = await extractPdfChunksForPaper({
    id: "local-colbert",
    sourcePath: "/tmp/LiteasyLibrary/papers/colbert.pdf",
    title: "ColBERT"
  }, { loadPdfSource });

  expect(loadPdfSource).toHaveBeenCalledWith("/tmp/LiteasyLibrary/papers/colbert.pdf");
  expect(chunks.length).toBeGreaterThan(0);
  expect(chunks[0]).toMatchObject({ paperId: "local-colbert" });
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
  const fixturePath = resolve(process.cwd(), "src/tests/assets/papers/liteasy-ocr-scanned-fixture.pdf");
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
  const fixturePath = resolve(process.cwd(), "src/tests/assets/papers/liteasy-ocr-scanned-fixture.pdf");
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

test("uses bundled English and Chinese language data for offline browser OCR", () => {
  const expected = {
    gzip: true,
    langPath: "http://localhost:3000/ocr"
  };
  expect(pdfOcrWorkerOptions("eng")).toEqual(expected);
  expect(pdfOcrWorkerOptions("chi_sim")).toEqual(expected);
  expect(pdfOcrWorkerOptions("eng+chi_sim")).toEqual(expected);
});
