import { afterEach, expect, test, vi } from "vitest";
import { deletePaperServiceKey, savePaperServiceKey } from "../app/features/paper-services/paperServiceTransport";
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

afterEach(() => { vi.unstubAllGlobals(); });

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

test("downloads an openly linked PDF without a cloud account or saved provider credentials", async () => {
  const config = { provider: "crossref" as const, endpoint: "https://publisher.example" };
  await savePaperServiceKey(config, "private-provider-key");
  const cloud = vi.fn();
  const bytes = new TextEncoder().encode("%PDF-1.7\nopen-access");
  const fetch = vi.fn(async (url: URL, init?: RequestInit) => {
    expect(init?.credentials).toBe("omit");
    expect(init?.headers).toBeUndefined();
    expect(url.href).not.toContain("private-provider-key");
    return url.hostname === "publisher.example"
      ? new Response(null, { status: 302, headers: { Location: "https://cdn.example/open.pdf" } })
      : new Response(bytes);
  });
  vi.stubGlobal("fetch", fetch);
  try {
    const result = await downloadRecommendationPdf({ endpoint: "https://cloud.invalid", transport: cloud,
      recommendation: { ...recommendation, openAccessPdfUrl: "https://publisher.example/open.pdf" } });
    expect(Array.from(result?.bytes ?? [])).toEqual(Array.from(bytes));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    expect(result?.contentHash).toBe(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));
    expect(result?.finalUrl).toBe("https://cdn.example/open.pdf");
    expect(result?.sourceId).toBe(recommendation.id);
    expect(cloud).not.toHaveBeenCalled();
  } finally { await deletePaperServiceKey(config); }
});

test("rejects publisher HTML even when the link and content type claim to be a PDF", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Access denied</html>", { headers: { "Content-Type": "application/pdf" } })));
  await expect(downloadRecommendationPdf({ endpoint: "", recommendation: { ...recommendation, openAccessPdfUrl: "https://publisher.example/open.pdf" } })).rejects.toThrow("不是 PDF");
});

test.each(["http://publisher.example/open.pdf", "https://user:password@publisher.example/open.pdf"])("rejects unsafe openly linked PDF URLs before requesting them: %s", async (openAccessPdfUrl) => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(downloadRecommendationPdf({ endpoint: "", recommendation: { ...recommendation, openAccessPdfUrl } })).rejects.toThrow("地址无效");
  expect(fetch).not.toHaveBeenCalled();
});
