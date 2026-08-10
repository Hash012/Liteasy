import type { PdfAnnotationV2 } from "./pdfAnnotationStorage";
import type { ForumAnnotationPublicationOperation } from "../forum/forum.types";
import type { LiteratureRecord } from "../paper-identity/literature.types";
import { sha256Hex } from "../paper-identity/paperIdentity";

function publicationQueueKey(annotation: PdfAnnotationV2) {
  return `${annotation.paperIdentity.paperId}:${annotation.id}`;
}

function publicationRevision(annotation: PdfAnnotationV2) {
  if (typeof annotation.revision !== "number" || !Number.isInteger(annotation.revision) || annotation.revision <= 0) {
    throw new Error("PDF 批注缺少可验证的本地修订号。");
  }
  return annotation.revision;
}

export function createUpsertOperation(
  annotation: PdfAnnotationV2,
  literature: LiteratureRecord
): Extract<ForumAnnotationPublicationOperation, { operation: "upsert" }> {
  return {
    annotationId: annotation.id,
    body: annotation.note?.trim() || annotation.excerpt,
    literatureId: literature.literatureId,
    operation: "upsert",
    queueKey: publicationQueueKey(annotation),
    revision: publicationRevision(annotation),
    sourcePassage: {
      anchorHash: `sha256:${sha256Hex([
        annotation.paperIdentity.paperId,
        String(annotation.page),
        annotation.excerpt
      ].join("\u0000"))}`,
      excerpt: annotation.excerpt,
      page: annotation.page,
      rects: annotation.rects.map((rect) => ({ ...rect }))
    },
    updatedAt: annotation.updatedAt
  };
}

export function createRetractOperation(
  annotation: PdfAnnotationV2
): Extract<ForumAnnotationPublicationOperation, { operation: "retract" }> {
  const remoteAnnotationId = annotation.publication?.remoteAnnotationId;
  if (!remoteAnnotationId) {
    throw new Error("PDF 批注缺少可撤回的论坛批注 ID。");
  }
  return {
    annotationId: annotation.id,
    operation: "retract",
    queueKey: publicationQueueKey(annotation),
    remoteAnnotationId,
    revision: publicationRevision(annotation),
    updatedAt: annotation.updatedAt
  };
}
