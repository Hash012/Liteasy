import type { RetrievalChunk } from "../retrieval/retrieval.types";
import { loadUserPaperArtifact } from "../library/userPaperArtifactClient";
import {
  attributeReferencesToAnchor,
  buildAnchorLocalReferenceIndex,
  type AnchorLocalReferences,
  type AnchorTextPosition
} from "../pdf/citationAttribution";
import {
  readGrobidCitationSnapshot,
  type GrobidCitationSnapshot
} from "../pdf/grobidCitationClient";
import {
  normalizePaperFulltext,
  paperFulltextPagesToRecord,
  type PaperPageTextRecord
} from "../pdf/paperFulltextStore";
import type { ThinReadingAnchor, ThinReadingEvidenceSpan } from "./thinReading.types";

export type ThinReadingAnchorReference = {
  number: number;
  text: string;
};

function normalizedChunkText(value: string) {
  return value
    .replace(/[^\S\r\n]+/gu, " ")
    .replace(/(?:\r?\n\s*)+/gu, "\n")
    .trim();
}

/** Rebuilds normalized page text from the complete retrieval index when the reader has not
 * persisted a full-text snapshot yet. Chunk offsets make overlaps deterministic. */
export function reconstructPageTextsFromChunks(
  chunks: readonly RetrievalChunk[]
): PaperPageTextRecord {
  const chunksByPage = new Map<number, RetrievalChunk[]>();
  for (const chunk of chunks) {
    if (chunk.pageTextStart === undefined || chunk.pageTextEnd === undefined) continue;
    const pageChunks = chunksByPage.get(chunk.page) ?? [];
    pageChunks.push(chunk);
    chunksByPage.set(chunk.page, pageChunks);
  }

  const pages: PaperPageTextRecord = {};
  for (const [page, pageChunks] of chunksByPage) {
    const ordered = [...pageChunks].sort((left, right) =>
      (left.pageTextStart ?? 0) - (right.pageTextStart ?? 0)
    );
    const length = Math.max(...ordered.map((chunk) => chunk.pageTextEnd ?? 0));
    const characters = Array.from({ length }, () => " ");
    for (const chunk of ordered) {
      const start = chunk.pageTextStart ?? 0;
      const end = chunk.pageTextEnd ?? start;
      const text = normalizedChunkText(chunk.snippet).slice(0, Math.max(0, end - start));
      for (let index = 0; index < text.length && start + index < characters.length; index += 1) {
        characters[start + index] = text[index];
      }
    }
    pages[page] = characters.join("").trimEnd();
  }
  return pages;
}

type EvidenceAnchorPosition = AnchorTextPosition & {
  thinReadingAnchorId: string;
};

function evidenceAnchorPositions(input: {
  anchors: readonly ThinReadingAnchor[];
  evidenceSpans: readonly ThinReadingEvidenceSpan[];
  paperId: string;
}) {
  const evidenceById = new Map(input.evidenceSpans.map((span) => [span.id, span]));
  return input.anchors.flatMap((anchor) => anchor.evidenceIds.flatMap((evidenceId) => {
    const span = evidenceById.get(evidenceId);
    if (!span || span.paperId !== input.paperId || span.page === undefined ||
      span.pageTextStart === undefined || span.pageTextEnd === undefined) {
      return [];
    }
    return [{
      id: `${anchor.id}:${span.id}`,
      page: span.page,
      sourceEnd: span.pageTextEnd,
      sourceStart: span.pageTextStart,
      thinReadingAnchorId: anchor.id
    } satisfies EvidenceAnchorPosition];
  }));
}

function attributePositions(input: {
  pageTexts: PaperPageTextRecord;
  positions: readonly EvidenceAnchorPosition[];
  snapshot?: GrobidCitationSnapshot | null;
}): AnchorLocalReferences[] {
  if (input.snapshot) {
    return input.positions.map((position) => attributeReferencesToAnchor(
      position,
      input.snapshot!.markers,
      { references: input.snapshot!.references, window: 0 }
    ));
  }
  return buildAnchorLocalReferenceIndex({
    anchors: input.positions,
    pages: Object.entries(input.pageTexts).map(([page, text]) => ({ page: Number(page), text })),
    window: 0
  });
}

/** Maps each generated thin-reading anchor to references cited inside the source evidence that
 * supports it. This keeps association retrieval reference-driven without using the whole paper's
 * citation neighbourhood. */
export function buildThinReadingAnchorReferenceIndex(input: {
  anchors: readonly ThinReadingAnchor[];
  evidenceSpans: readonly ThinReadingEvidenceSpan[];
  pageTexts: PaperPageTextRecord;
  paperId: string;
  snapshot?: GrobidCitationSnapshot | null;
}) {
  const positions = evidenceAnchorPositions(input);
  const thinAnchorIdByPositionId = new Map(
    positions.map((position) => [position.id, position.thinReadingAnchorId])
  );
  const referencesByAnchorId = new Map<string, ThinReadingAnchorReference[]>();
  for (const attributed of attributePositions({
    pageTexts: input.pageTexts,
    positions,
    snapshot: input.snapshot
  })) {
    const anchorId = thinAnchorIdByPositionId.get(attributed.anchorId);
    if (!anchorId) continue;
    const references = referencesByAnchorId.get(anchorId) ?? [];
    for (const reference of attributed.references) {
      const text = reference.text.replace(/\s+/gu, " ").trim();
      if (!text || references.some((existing) => existing.text === text)) continue;
      references.push({ number: reference.number, text });
    }
    referencesByAnchorId.set(anchorId, references.slice(0, 12));
  }
  return referencesByAnchorId;
}

export async function loadThinReadingAnchorReferenceIndex(input: {
  anchors: readonly ThinReadingAnchor[];
  evidenceSpans: readonly ThinReadingEvidenceSpan[];
  importedChunks: readonly RetrievalChunk[];
  paperId: string;
}) {
  const [storedFulltext, storedCitations] = await Promise.all([
    loadUserPaperArtifact<unknown>({ artifactKind: "fulltext", paperId: input.paperId })
      .catch(() => undefined),
    loadUserPaperArtifact<unknown>({ artifactKind: "citations", paperId: input.paperId })
      .catch(() => undefined)
  ]);
  const fulltext = normalizePaperFulltext(storedFulltext);
  const pageTexts = fulltext
    ? paperFulltextPagesToRecord(fulltext.pages)
    : reconstructPageTextsFromChunks(input.importedChunks);
  return buildThinReadingAnchorReferenceIndex({
    anchors: input.anchors,
    evidenceSpans: input.evidenceSpans,
    pageTexts,
    paperId: input.paperId,
    snapshot: readGrobidCitationSnapshot(storedCitations)
  });
}
