import { expect, test, vi } from "vitest";
import { downloadRecommendationPdf } from "../app/features/recommendations/recommendationPdfClient";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";

const recommendation: RecommendationItem = {
  canonicalId: "doi:10.1000/test",
  discoveredAt: "2026-08-07T00:00:00.000Z",
  id: "reading-candidate:doi:10.1000/test",
  openAccessAvailable: true,
  reason: "Related work",
  relatedDocumentTitle: "Target paper",
  relevanceBand: "high",
  relevanceScore: 0.9,
  source: "Crossref",
  sourceKind: "live",
  sourceUrl: "https://doi.org/10.1000/test",
  title: "Recommended paper"
};

test("reissues a recommendation grant and downloads the subject-bound PDF", async () => {
  const bytes = new TextEncoder().encode("%PDF-1.7\nrecommended");
  const requests: Array<{ body: string; url: string }> = [];
  const transport = vi.fn(async (request: { body: string; url: string }) => {
    requests.push(request);
    if (request.url.endsWith("/pdf-grant")) {
      return {
        json: async () => ({
          fullTextGrantId: "pdfgrant_12345678-abcd",
          fullTextUrl: "https://publisher.example/paper.pdf",
          sourceId: recommendation.id
        }),
        ok: true,
        status: 200
      };
    }
    return {
      json: async () => ({
        byteLength: bytes.byteLength,
        bytesBase64: btoa(String.fromCharCode(...bytes)),
        contentHash: "a".repeat(64),
        contentType: "application/pdf",
        finalUrl: "https://publisher.example/paper.pdf",
        sourceId: recommendation.id
      }),
      ok: true,
      status: 200
    };
  });

  const result = await downloadRecommendationPdf({
    endpoint: "https://cloud.example.test",
    recommendation,
    transport
  });

  expect(Array.from(result?.bytes ?? [])).toEqual(Array.from(bytes));
  expect(requests.map((request) => request.url)).toEqual([
    "https://cloud.example.test/v1/recommendations/pdf-grant",
    "https://cloud.example.test/v1/research/external-pdf"
  ]);
  expect(JSON.parse(requests[0].body)).toEqual({ candidateId: recommendation.id });
  expect(JSON.parse(requests[1].body)).toEqual({
    grantId: "pdfgrant_12345678-abcd",
    sourceId: recommendation.id
  });
});

test("returns metadata fallback only for an explicit unavailable-PDF response", async () => {
  const transport = vi.fn(async () => ({
    json: async () => ({
      code: "recommendation_pdf_unavailable",
      message: "No PDF"
    }),
    ok: false,
    status: 404
  }));

  await expect(downloadRecommendationPdf({
    endpoint: "https://cloud.example.test",
    recommendation,
    transport
  })).resolves.toBeNull();
  expect(transport).toHaveBeenCalledOnce();
});

test("does not contact the grant service for metadata-only recommendations", async () => {
  const transport = vi.fn();
  await expect(downloadRecommendationPdf({
    endpoint: "https://cloud.example.test",
    recommendation: { ...recommendation, openAccessAvailable: false },
    transport
  })).resolves.toBeNull();
  expect(transport).not.toHaveBeenCalled();
});
