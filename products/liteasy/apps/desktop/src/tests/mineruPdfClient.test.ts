import { afterEach, expect, test, vi } from "vitest";
import {
  extractMineruPdfResources,
  extractPdfResourcesWithMineruFallback
} from "../app/features/import/mineruPdfClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("preserves the original MinerU Markdown alongside retrieval chunks", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({
      figures: [],
      markdown: "# Full extraction\n\n$E = mc^2$",
      pages: [{ page: 1, text: "Full extraction E = mc^2", textExtraction: "mineru" }]
    }),
    ok: true
  });
  vi.stubGlobal("fetch", fetchMock);

  const result = await extractMineruPdfResources({
    endpoint: "http://127.0.0.1:8787",
    loadPdfSource: async () => new Uint8Array([37, 80, 68, 70, 45]),
    paper: { id: "paper-1", sourcePath: "/library/paper.pdf", title: "Full extraction" }
  });

  expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/v1/pdf/mineru-extract", expect.objectContaining({ method: "POST" }));
  expect(result.chunks[0]).toMatchObject({
    sourceMarkdown: "# Full extraction\n\n$E = mc^2$",
    textExtraction: "mineru"
  });
});

test("falls back to local PDF extraction when MinerU is unavailable", async () => {
  const fallbackChunks = [{
    page: 1,
    paperId: "paper-1",
    paperTitle: "Fallback paper",
    snippet: "Locally extracted text",
    summary: "Locally extracted text",
    tags: ["PDF 全文"],
    textExtraction: "embedded" as const
  }];
  const extractFallback = vi.fn().mockResolvedValue(fallbackChunks);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    json: async () => ({ message: "MinerU 未配置。" }),
    ok: false
  }));

  const result = await extractPdfResourcesWithMineruFallback({
    endpoint: "http://127.0.0.1:8787",
    extractFallback,
    loadPdfSource: async () => new Uint8Array([37, 80, 68, 70, 45]),
    paper: { id: "paper-1", sourcePath: "/library/paper.pdf", title: "Fallback paper" }
  });

  expect(result).toEqual({ chunks: fallbackChunks, figures: [] });
  expect(extractFallback).toHaveBeenCalledOnce();
});

test("does not run fallback extraction after MinerU succeeds", async () => {
  const extractFallback = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    json: async () => ({
      figures: [],
      pages: [{ page: 1, text: "MinerU text", textExtraction: "mineru" }]
    }),
    ok: true
  }));

  const result = await extractPdfResourcesWithMineruFallback({
    endpoint: "http://127.0.0.1:8787",
    extractFallback,
    loadPdfSource: async () => new Uint8Array([37, 80, 68, 70, 45]),
    paper: { id: "paper-1", sourcePath: "/library/paper.pdf", title: "MinerU paper" }
  });

  expect(result.chunks[0]).toMatchObject({ snippet: "MinerU text", textExtraction: "mineru" });
  expect(extractFallback).not.toHaveBeenCalled();
});

test("uses local parsing without any cloud request for personal API mode", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const fallback = vi.fn(async () => []);
  await extractPdfResourcesWithMineruFallback({
    endpoint: "https://unavailable.invalid", preferLocal: true, extractFallback: fallback,
    loadPdfSource: async () => new Uint8Array(), paper: { id: "local", sourcePath: "C:\\论文.pdf", title: "论文" }
  });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(fallback).toHaveBeenCalledOnce();
});

test("aborts stalled cloud extraction and continues with the local PDF", async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal("fetch", vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
    })));
    const fallback = vi.fn(async () => []);
    const result = extractPdfResourcesWithMineruFallback({
      endpoint: "https://unavailable.invalid", extractFallback: fallback,
      loadPdfSource: async () => new Uint8Array(), paper: { id: "local", sourcePath: "paper.pdf", title: "论文" }
    });
    await vi.advanceTimersByTimeAsync(15_001);
    await expect(result).resolves.toEqual({ chunks: [], figures: [] });
    expect(fallback).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});
