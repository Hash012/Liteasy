import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, test, vi } from "vitest";
import { createThinReadingExternalFullTextClient } from "../app/features/thin-reading/thinReadingExternalFullTextClient";
import type { ThinReadingExternalSource } from "../app/features/thin-reading/thinReading.types";

pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
  resolve(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")
).href;

const source: ThinReadingExternalSource = {
  abstract: "A method abstract with measurable results.",
  authors: ["A. Author"],
  fullTextGrantId: "pdfgrant_12345678-abcd",
  fullTextUrl: "https://papers.example.test/paper.pdf",
  id: "openalex:W42",
  provider: "openalex",
  relation: "topic_search",
  relevance: 0.9,
  retrievalQuery: "measurable method results",
  sourceId: "W42",
  sourceRecordUrl: "https://openalex.org/W42",
  title: "Measured Method",
  url: "https://openalex.org/W42"
};

describe("thinReadingExternalFullTextClient", () => {
  test("extracts page evidence with content-addressed stable IDs", async () => {
    const bytes = readFileSync(resolve(process.cwd(), "src/tests/assets/papers/colbert-late-interaction.pdf"));
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const transport = async () => ({
      json: async () => ({
        byteLength: bytes.byteLength,
        bytesBase64: bytes.toString("base64"),
        contentHash,
        contentType: "application/pdf",
        finalUrl: source.fullTextUrl,
        sourceId: source.id
      }),
      ok: true,
      status: 200
    });
    const cachePdf = vi.fn(async () => "C:\\cache\\paper.pdf");
    const client = createThinReadingExternalFullTextClient({
      cachePdf,
      endpoint: "https://liteasy.example.test",
      transport
    });

    const first = await client(source);
    const second = await client(source);
    expect(first.evidenceBasis).toBe("full_text");
    expect(first).toMatchObject({
      localPdfCachePath: "C:\\cache\\paper.pdf",
      localPdfContentHash: contentHash
    });
    expect(cachePdf).toHaveBeenCalledWith(expect.objectContaining({
      bytes: expect.any(Uint8Array),
      contentHash
    }));
    expect(first.fullTextEvidence?.length).toBeGreaterThan(0);
    expect(first.fullTextEvidence).toEqual(second.fullTextEvidence);
    expect(first.fullTextEvidence?.[0]).toMatchObject({
      contentHash,
      finalUrl: source.fullTextUrl,
      page: expect.any(Number),
      quote: expect.any(String),
      textExtraction: "embedded"
    });
    expect(first.fullTextEvidence?.[0].id).toMatch(
      new RegExp(`^external-evidence:openalex%3AW42:${contentHash}:p\\d+:c\\d+$`)
    );
  }, 15_000);

  test("rejects a PDF whose returned bytes do not match the server hash", async () => {
    const bytesBase64 = btoa("%PDF-1.7\nnot a complete fixture");
    const transport = vi.fn(async () => ({
      json: async () => ({
        byteLength: atob(bytesBase64).length,
        bytesBase64,
        contentHash: "0".repeat(64),
        contentType: "application/pdf",
        finalUrl: source.fullTextUrl,
        sourceId: source.id
      }),
      ok: true,
      status: 200
    }));
    const client = createThinReadingExternalFullTextClient({
      endpoint: "https://liteasy.example.test",
      transport
    });

    await expect(client(source)).rejects.toThrow("完整性校验失败");
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      body: JSON.stringify({ grantId: source.fullTextGrantId, sourceId: source.id }),
      url: "https://liteasy.example.test/v1/research/external-pdf"
    }));
  });
});
