import { compileSearchQuery, type SearchMetadata } from "../search/searchQuery";
import { annotationNoteLabels, noteLabels } from "../notes/noteLabels";
import type { TeamAnnotation } from "../organization/teamAnnotationClient";
import type { PdfAnnotation, PdfAnnotationV2 } from "./pdfAnnotationStorage";

export function teamPdfAnnotation(team: TeamAnnotation, paperIdentity: PdfAnnotation["paperIdentity"]): PdfAnnotation {
  return { ...team.body, id: team.annotationId, paperIdentity, createdAt: team.createdAt, updatedAt: team.updatedAt };
}

/** Keep the sidebar and overview searchable by the same user-visible content. */
export function compilePdfAnnotationQuery(query: string, metadata?: SearchMetadata) {
  const compiled = compileSearchQuery(query);
  return {
    error: compiled.error,
    matches(annotation: PdfAnnotation, author?: string) {
      const text = [annotation.excerpt, annotation.note, annotation.text, annotation.quickAsk?.question,
        annotation.quickAsk?.answer, annotation.review?.text, author, String(annotation.page)].filter(Boolean).join(" ");
      return compiled.matches(text, {
        format: "pdf", ...metadata,
        tags: [...(metadata?.tags ?? []), ...annotationNoteLabels(annotation as PdfAnnotationV2).flatMap((label) => [label, noteLabels[label]])]
      });
    }
  };
}
