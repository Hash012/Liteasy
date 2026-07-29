import { describe, expect, test, vi } from "vitest";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";
import {
  listPdfAnnotationPendingPublicItems,
  syncPdfAnnotationPendingItems
} from "../app/features/pdf/pdfAnnotationIntuechoSync";
import type { PdfAnnotation } from "../app/features/pdf/pdfAnnotationStorage";

function annotation(input: Partial<PdfAnnotation> = {}): PdfAnnotation {
  return {
    createdAt: "2026-07-28T00:00:00.000Z",
    excerpt: "The selected PDF passage.",
    id: "pdf-annotation-1",
    kind: "note",
    page: 3,
    paperIdentity: resolvePaperIdentity({
      doi: "10.1000/example",
      id: "paper-1",
      title: "A syncable paper"
    }),
    rects: [{ height: 2, left: 12, top: 18, width: 36 }],
    text: "注释",
    updatedAt: "2026-07-28T00:00:00.000Z",
    visibility: "pending_public",
    ...input
  };
}

describe("pdf annotation Intuecho sync", () => {
  test("preserves concrete PDF passage scope and uses the note as shared content", () => {
    const [item] = listPdfAnnotationPendingPublicItems([annotation({ note: "A reader's interpretation." })]);

    expect(item).toMatchObject({
      body: "A reader's interpretation.",
      paperIdentity: { primary: { kind: "doi", value: "10.1000/example" } },
      scope: { kind: "pdf_passage", page: 3, rects: [{ height: 2, left: 12, top: 18, width: 36 }] }
    });
  });

  test("does not send local-only paper annotations to the community endpoint", async () => {
    const items = listPdfAnnotationPendingPublicItems([annotation({
      paperIdentity: resolvePaperIdentity({ id: "local-paper", title: "Local only" })
    })]);
    const transport = vi.fn();

    const [result] = await syncPdfAnnotationPendingItems({
      endpoint: "https://intuecho.example.com/community",
      items,
      transport
    });

    expect(transport).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "failed", error: expect.stringContaining("仅本地文献身份") });
  });

  test("accepts a verified receipt only for the matching queue item", async () => {
    const [item] = listPdfAnnotationPendingPublicItems([annotation()]);
    const transport = vi.fn(async (request) => {
      expect(request.url).toBe("https://intuecho.example.com/community/v1/pdf-annotations:sync");
      expect(JSON.parse(request.body)).toMatchObject({ annotations: [expect.objectContaining({ queueKey: item.queueKey })] });
      return {
        json: async () => ({ results: [{
          annotationId: item.annotationId,
          intuechoAnnotationId: "intuecho-pdf-1",
          queueKey: item.queueKey,
          status: "synced",
          syncedAt: "2026-07-28T01:00:00.000Z"
        }] }),
        ok: true,
        status: 200
      };
    });

    await expect(syncPdfAnnotationPendingItems({
      endpoint: "https://intuecho.example.com/community/?preview=true#annotations",
      items: [item],
      transport
    })).resolves.toEqual([{
      annotationId: item.annotationId,
      intuechoAnnotationId: "intuecho-pdf-1",
      queueKey: item.queueKey,
      status: "synced",
      syncedAt: "2026-07-28T01:00:00.000Z"
    }]);
  });
});
