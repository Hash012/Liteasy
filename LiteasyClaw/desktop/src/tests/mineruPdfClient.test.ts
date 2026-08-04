import { afterEach, expect, test, vi } from "vitest";
import { extractMineruPdfResources } from "../app/features/import/mineruPdfClient";

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
