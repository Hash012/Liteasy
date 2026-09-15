import type { Root } from "mdast";
import { z } from "zod";
import { anchorSchema, objectRefSchema, type ObjectAnchor } from "../objects/objectAnchor.types";

const opaqueId = z.string().min(1).max(2048);
export const paperAnchorEntitySchema = z.strictObject({
  schema: z.literal("liteasy.paper-anchor/v1"),
  id: opaqueId,
  evidenceIds: z.array(opaqueId),
  source: z.strictObject({
    paperId: opaqueId,
    objectRef: objectRefSchema.optional(),
    selector: anchorSchema.optional(),
    documentHash: z.string().optional(),
  }),
  locator: z.strictObject({
    page: z.number().int().positive().optional(),
    pageTextStart: z.number().int().nonnegative().optional(),
    pageTextEnd: z.number().int().nonnegative().optional(),
    textExtraction: z.enum(["embedded", "mineru", "ocr"]).optional(),
    precision: z.enum(["text", "page", "unavailable"]),
  }),
  snapshot: z.strictObject({ quote: z.string(), summary: z.string().optional() }),
  provenance: z.strictObject({
    sourceRecordId: opaqueId,
    analysisRunId: opaqueId.optional(),
    chunkId: opaqueId.optional(),
  }),
  presentation: z.strictObject({
    kind: z.literal("paper-citation"),
    placement: z.literal("after-content"),
    title: z.string().min(1),
    location: z.string().min(1),
  }),
}).superRefine((anchor, context) => {
  const { page, pageTextStart, pageTextEnd, precision } = anchor.locator;
  if ((pageTextStart !== undefined || pageTextEnd !== undefined) &&
    !(pageTextStart !== undefined && pageTextEnd !== undefined && pageTextEnd > pageTextStart)) {
    context.addIssue({ code: "custom", path: ["locator"], message: "Invalid source text range" });
  }
  if ((!page && precision !== "unavailable") ||
    (precision === "text" && (pageTextStart === undefined || pageTextEnd === undefined))) {
    context.addIssue({ code: "custom", path: ["locator"], message: "Source precision requires a recorded location" });
  }
});

/** A citation owns its presentation and source snapshot. A title or location is never its identity. */
export type PaperAnchorEntity = z.infer<typeof paperAnchorEntitySchema>;

/** Validate persisted metadata and deduplicate exact entities without merging ambiguous identities. */
export function collectPaperAnchors(...groups: readonly (readonly unknown[])[]): PaperAnchorEntity[] {
  const seen = new Set<string>();
  return groups.flatMap((group) => group.flatMap((value) => {
    const parsed = paperAnchorEntitySchema.safeParse(value);
    if (!parsed.success) return [];
    const key = JSON.stringify(parsed.data);
    if (seen.has(key)) return [];
    seen.add(key);
    return [parsed.data];
  }));
}
export type PaperAnchorEvidence = {
  id: string;
  paperId: string;
  paperTitle?: string;
  page?: number;
  pageTextStart?: number;
  pageTextEnd?: number;
  textExtraction?: "embedded" | "mineru" | "ocr";
  quote: string;
  summary?: string;
  chunkId?: string;
  analysisRunId?: string;
  paperAnchor?: PaperAnchorEntity;
};

const internalEvidencePattern = /\[?\bevidence-[A-Za-z0-9][A-Za-z0-9_-]*\b\]?/gu;
const safePresentationText = (value: string) => value.replace(internalEvidencePattern, "〔来源待关联〕");

export function paperAnchorFromEvidence(evidence: PaperAnchorEvidence): PaperAnchorEntity {
  const stored = paperAnchorEntitySchema.safeParse(evidence.paperAnchor);
  // Never accept an embedded entity that points at a different record or snapshot.
  if (stored.success && stored.data.id === evidence.id && stored.data.provenance.sourceRecordId === evidence.id &&
    stored.data.evidenceIds.length === 1 && stored.data.evidenceIds[0] === evidence.id &&
    stored.data.source.paperId === evidence.paperId && stored.data.snapshot.quote === evidence.quote &&
    stored.data.locator.page === evidence.page && stored.data.locator.pageTextStart === evidence.pageTextStart &&
    stored.data.locator.pageTextEnd === evidence.pageTextEnd && stored.data.locator.textExtraction === evidence.textExtraction) {
    return stored.data;
  }
  const page = Number.isInteger(evidence.page) && evidence.page! > 0 ? evidence.page : undefined;
  const hasRange = Number.isInteger(evidence.pageTextStart) && evidence.pageTextStart! >= 0 &&
    Number.isInteger(evidence.pageTextEnd) && evidence.pageTextEnd! > evidence.pageTextStart!;
  return {
    schema: "liteasy.paper-anchor/v1",
    id: evidence.id,
    evidenceIds: [evidence.id],
    source: { paperId: evidence.paperId },
    locator: {
      ...(page ? { page } : {}),
      ...(hasRange ? { pageTextStart: evidence.pageTextStart, pageTextEnd: evidence.pageTextEnd } : {}),
      ...(evidence.textExtraction ? { textExtraction: evidence.textExtraction } : {}),
      precision: !page ? "unavailable" : hasRange ? "text" : "page",
    },
    snapshot: { quote: evidence.quote, ...(evidence.summary ? { summary: evidence.summary } : {}) },
    provenance: {
      sourceRecordId: evidence.id,
      ...(evidence.analysisRunId ? { analysisRunId: evidence.analysisRunId } : {}),
      ...(evidence.chunkId ? { chunkId: evidence.chunkId } : {}),
    },
    presentation: {
      kind: "paper-citation",
      placement: "after-content",
      title: safePresentationText(evidence.paperTitle?.trim() || "引用文献"),
      location: page ? `第 ${page} 页` : "页码未记录",
    },
  };
}

/** Legacy citations have no evidence ID. Keep their owning record identity; never guess an ID binding. */
export function paperAnchorsFromCitations(
  citations: readonly { paperId: string; page: number; snippet: string; paperAnchor?: PaperAnchorEntity }[],
  papers: readonly { id: string; title: string }[],
  ownerId: string,
) {
  const seen = new Set<string>();
  return citations.flatMap((citation, index) => {
    const stored = paperAnchorEntitySchema.safeParse(citation.paperAnchor);
    const entity = stored.success && stored.data.source.paperId === citation.paperId &&
      stored.data.locator.page === citation.page && stored.data.snapshot.quote === citation.snippet
      ? stored.data
      : { ...paperAnchorFromEvidence({
        id: `${ownerId}:citation:${index}`,
        paperId: citation.paperId,
        paperTitle: papers.find((paper) => paper.id === citation.paperId)?.title,
        page: citation.page,
        quote: citation.snippet,
      }), evidenceIds: [] };
    const key = JSON.stringify([entity.source, entity.locator, entity.snapshot.quote]);
    if (seen.has(key)) return [];
    seen.add(key);
    return [entity];
  });
}

export function paperAnchorFromObject(input: {
  id: string; paperId: string; paperTitle: string; anchor: Extract<ObjectAnchor, { type: "pdf" }>;
}) {
  const { anchor } = input;
  const entity = paperAnchorFromEvidence({
    id: input.id, paperId: input.paperId, paperTitle: input.paperTitle, page: anchor.page,
    quote: anchor.quote.exact, pageTextStart: anchor.range?.start, pageTextEnd: anchor.range?.end,
  });
  return {
    ...entity,
    source: { ...entity.source, objectRef: anchor.sourceRef, documentHash: anchor.documentHash, selector: anchor },
    locator: { ...entity.locator, precision: anchor.precision === "page" ? "page" as const : entity.locator.precision },
    presentation: { ...entity.presentation, location: anchor.displayPage ? `第 ${anchor.displayPage} 页` : entity.presentation.location },
  };
}

export function paperAnchorLabel(anchor: PaperAnchorEntity) {
  return safePresentationText(`${anchor.presentation.title} · ${anchor.presentation.location}`);
}

export function paperAnchorOpenRequest(anchor: PaperAnchorEntity) {
  if (!anchor.locator.page) return undefined;
  return {
    evidenceId: anchor.id,
    paperId: anchor.source.paperId,
    page: anchor.locator.page,
    quote: anchor.snapshot.quote,
    ...(anchor.locator.pageTextStart !== undefined ? { pageTextStart: anchor.locator.pageTextStart } : {}),
    ...(anchor.locator.pageTextEnd !== undefined ? { pageTextEnd: anchor.locator.pageTextEnd } : {}),
    ...(anchor.locator.textExtraction ? { textExtraction: anchor.locator.textExtraction } : {}),
  };
}

export function paperCitationOpenRequest(citation: {
  paperId: string; page: number; snippet: string; paperAnchor?: PaperAnchorEntity;
}) {
  const stored = paperAnchorEntitySchema.safeParse(citation.paperAnchor);
  if (stored.success && stored.data.source.paperId === citation.paperId &&
    stored.data.locator.page === citation.page && stored.data.snapshot.quote === citation.snippet) {
    const request = paperAnchorOpenRequest(stored.data);
    if (request) return request;
  }
  return {
    evidenceId: `citation-${citation.paperId}-${citation.page}`,
    paperId: citation.paperId,
    page: citation.page,
    quote: citation.snippet,
  };
}

export function createPaperAnchorFormatter(anchors: readonly PaperAnchorEntity[] = []) {
  const byId = new Map<string, PaperAnchorEntity | null>();
  for (const anchor of anchors) {
    for (const id of anchor.evidenceIds) {
      const previous = byId.get(id);
      // Conflicting bindings remain unresolved instead of sending users to an arbitrary paper.
      if (previous === null || (previous && JSON.stringify([previous.source, previous.locator, previous.snapshot]) !==
        JSON.stringify([anchor.source, anchor.locator, anchor.snapshot]))) byId.set(id, null);
      else byId.set(id, anchor);
    }
  }
  return (value: string) => value.replace(internalEvidencePattern, (marker) => {
    const id = marker.replace(/^\[|\]$/gu, "");
    const anchor = byId.get(id);
    return `〔${anchor ? paperAnchorLabel(anchor) : "来源待关联"}〕`;
  });
}

export function formatPaperAnchorText(value: string, anchors: readonly PaperAnchorEntity[] = []) {
  return createPaperAnchorFormatter(anchors)(value);
}

/** Run after domain markup plugins: source offsets remain valid for sentence/selection anchors. */
export function remarkPaperAnchorReferences(anchors: readonly PaperAnchorEntity[] = []) {
  const format = createPaperAnchorFormatter(anchors);
  return function () {
    return (tree: Root) => {
      const visit = (node: { type: string; value?: string; children?: unknown[]; alt?: string; title?: string }) => {
        if (node.type === "text" && node.value) node.value = format(node.value);
        if (node.type === "image" && node.alt) node.alt = format(node.alt);
        if (["image", "link"].includes(node.type) && node.title) node.title = format(node.title);
        node.children?.forEach((child) => visit(child as Parameters<typeof visit>[0]));
      };
      visit(tree);
    };
  };
}
