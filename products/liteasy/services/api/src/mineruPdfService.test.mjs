import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  maximumMineruPdfBytes,
  MineruPdfError,
  MineruPdfService
} from "./mineruPdfService.mjs";

function request(bytes = Buffer.from("%PDF-1.7\nfixture"), filename = "paper.pdf") {
  return { bytesBase64: bytes.toString("base64"), filename };
}

test("extracts a validated PDF using a private temporary file", async () => {
  let observedPath;
  const service = new MineruPdfService({ maximumConcurrency: 2, timeoutMs: 30_000, token: "mineru-test-token" }, {
    extractImpl: async ({ pdfPath, timeoutSeconds, token }) => {
      observedPath = pdfPath;
      assert.equal(token, "mineru-test-token");
      assert.equal(timeoutSeconds, 30);
      assert.equal((await readFile(pdfPath)).subarray(0, 5).toString("ascii"), "%PDF-");
      return {
        contentList: [{ page_idx: 0, text: "Extracted page" }],
        images: [{ data: Uint8Array.from([1, 2, 3]), name: "figure.png", path: "images/figure.png" }],
        markdown: "# Extracted page",
        state: "done"
      };
    }
  });
  const result = await service.extract(request(), { subjectId: "user-1", traceId: "trace-1" });
  assert.equal(result.markdown, "# Extracted page");
  assert.deepEqual(result.pages, [{ page: 1, text: "Extracted page", textExtraction: "mineru" }]);
  assert.match(result.figures[0].dataUrl, /^data:image\/png;base64,/);
  await assert.rejects(access(observedPath));
});

test("rejects malformed, oversized, and non-PDF content before extraction", async () => {
  let calls = 0;
  const service = new MineruPdfService({ token: "mineru-test-token" }, {
    extractImpl: async () => { calls += 1; }
  });
  await assert.rejects(service.extract({ bytesBase64: "%%%", filename: "paper.pdf" }), (error) => (
    error instanceof MineruPdfError && error.code === "invalid_mineru_pdf_request"
  ));
  await assert.rejects(service.extract(request(Buffer.from("not a PDF"))), (error) => (
    error instanceof MineruPdfError && error.code === "invalid_mineru_pdf_content"
  ));
  await assert.rejects(service.extract(request(Buffer.alloc(maximumMineruPdfBytes + 1))), (error) => (
    error instanceof MineruPdfError && error.code === "invalid_mineru_pdf_request"
  ));
  assert.equal(calls, 0);
});

test("validates a maximum-size base64 request without regular expression stack overflow", async () => {
  const bytes = Buffer.alloc(maximumMineruPdfBytes);
  bytes.write("%PDF-");
  const service = new MineruPdfService({ token: "mineru-test-token" }, {
    extractImpl: async () => ({ contentList: [], images: [], markdown: "large", state: "done" })
  });
  const result = await service.extract({ bytesBase64: bytes.toString("base64"), filename: "large.pdf" });
  assert.equal(result.markdown, "large");
});

test("deduplicates in-flight extraction and maps upstream details to a safe error", async () => {
  let resolveExtraction;
  const logged = [];
  const service = new MineruPdfService({ maximumConcurrency: 1, token: "mineru-test-token" }, {
    extractImpl: () => new Promise((resolve) => { resolveExtraction = resolve; }),
    logger: { error: (...values) => logged.push(values) }
  });
  const first = service.extract(request(), { subjectId: "user-1", traceId: "trace-1" });
  const second = service.extract(request(), { subjectId: "user-1", traceId: "trace-2" });
  while (!resolveExtraction) await new Promise((resolve) => setImmediate(resolve));
  resolveExtraction({ contentList: [], images: [], markdown: "done", state: "done" });
  assert.equal((await first).cache, "miss");
  assert.equal((await second).cache, "shared");

  const failing = new MineruPdfService({ token: "mineru-test-token" }, {
    extractImpl: async () => { throw new Error("secret at /srv/private/parser.sql"); },
    logger: { error: (...values) => logged.push(values) }
  });
  await assert.rejects(failing.extract(request()), (error) => (
    error instanceof MineruPdfError && error.code === "mineru_extraction_failed" && error.status === 502
  ));
  assert.doesNotMatch(JSON.stringify(logged), /secret at|parser\.sql/);
});

test("reports a missing MinerU token without importing or calling the SDK", async () => {
  const service = new MineruPdfService({});
  await assert.rejects(service.extract(request()), (error) => (
    error instanceof MineruPdfError && error.code === "mineru_not_configured" && error.status === 503
  ));
});

test("enriches extracted figures with the configured vision model without making extraction depend on it", async () => {
  let analysisCalls = 0;
  const extraction = {
    contentList: [],
    images: [{ data: Uint8Array.from([1, 2, 3]), name: "figure.png", path: "figure.png" }],
    markdown: "done",
    state: "done"
  };
  const service = new MineruPdfService({
    model: { apiKey: "model-secret", baseUrl: "https://models.example/v1", model: "vision-model" },
    token: "mineru-test-token"
  }, {
    analyzeFiguresImpl: async ({ figures, modelConfig }) => {
      analysisCalls += 1;
      assert.equal(modelConfig.model, "vision-model");
      return {
        figures: figures.map((figure) => ({ ...figure, analysis: { importance: "primary" } })),
        selectedFigureIds: [figures[0].id],
        status: "completed"
      };
    },
    extractImpl: async () => extraction
  });
  const result = await service.extract(request());
  assert.equal(analysisCalls, 1);
  assert.deepEqual(result.figureAnalysis, { selectedFigureIds: ["mineru-figure-1"], status: "completed" });

  const fallback = new MineruPdfService({
    model: { apiKey: "model-secret", baseUrl: "https://models.example/v1", model: "vision-model" },
    token: "mineru-test-token"
  }, {
    analyzeFiguresImpl: async () => { throw new Error("provider secret and internal path"); },
    extractImpl: async () => extraction
  });
  const fallbackResult = await fallback.extract(request());
  assert.equal(fallbackResult.figureAnalysis.status, "unavailable");
  assert.equal(fallbackResult.figures.length, 1);
});
