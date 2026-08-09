import { z } from "zod";

import { inferPaperIdentityMetadataFromPdfText, paperIdentityFromLiterature, resolvePaperIdentity } from "./paperIdentity";
import type { PaperIdentity, PaperIdentityCandidate } from "./paperIdentity";
import type { Paper } from "../workspace/workspace.types";
import type {
  LiteratureRecord,
  LiteratureResolveInput,
  LiteratureSnapshot
} from "./literature.types";

const literatureIdentifierSchema = z.object({
  kind: z.enum([
    "doi",
    "arxiv_id",
    "semantic_scholar_id",
    "openalex_id",
    "title_authors_year_hash"
  ]),
  source: z.enum(["public_registry", "manual", "inferred"]),
  value: z.string().trim().min(1).max(1000)
}).strict();
const literatureRecordSchema = z.object({
  authors: z.array(z.string().trim().min(1).max(300)).max(200),
  documentType: z.string().trim().min(1).max(100).optional(),
  identifiers: z.array(literatureIdentifierSchema).min(1).max(20),
  literatureId: z.string().trim().min(1).max(200),
  provenance: z.object({
    confirmedAt: z.string().datetime({ offset: true }),
    mode: z.enum(["public_registry", "manual"]),
    provider: z.enum(["intuecho", "openalex", "crossref", "arxiv", "semantic_scholar"]).optional()
  }).strict(),
  title: z.string().trim().min(1).max(1000),
  year: z.number().int().min(1000).max(9999).optional()
}).strict().superRefine((record, context) => {
  if (record.identifiers.some((identifier) => identifier.source !== record.provenance.mode)) {
    context.addIssue({
      code: "custom",
      message: "文献标识来源必须与确认来源一致。",
      path: ["identifiers"]
    });
  }
});
const literatureSnapshotSchema = z.object({
  literature: literatureRecordSchema,
  version: z.literal(1)
}).strict();

type PdfEmbeddedMetadata = {
  arxivId?: unknown;
  authors?: unknown;
  doi?: unknown;
  semanticScholarId?: unknown;
  title?: unknown;
  year?: unknown;
};

function compact(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeAuthors(value: unknown): string[] {
  const text = compact(value);
  const authors = Array.isArray(value)
    ? value.map(compact)
    : text ? text.split(/\s*(?:;|\band\b|和|、)\s*/i).map(compact) : [];
  return authors.filter(Boolean).slice(0, 200).map((author) => author.slice(0, 300));
}

function normalizeYear(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(compact(value));
  return Number.isInteger(number) && number >= 1000 && number <= 9999 ? number : undefined;
}

export function normalizeLiteratureSnapshot(value: unknown): LiteratureSnapshot {
  const parsed = literatureSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("文献元数据快照无效。");
  }
  return parsed.data;
}

export { paperIdentityFromLiterature };

export function createPdfLiteratureHints(
  paper: Pick<Paper, "arxivId" | "doi" | "id" | "semanticScholarId" | "title">,
  input: { embeddedMetadata?: PdfEmbeddedMetadata; firstPageText?: string }
): NonNullable<LiteratureResolveInput["hints"]> {
  const embedded = input.embeddedMetadata ?? {};
  const inferred = inferPaperIdentityMetadataFromPdfText((input.firstPageText ?? "").slice(0, 20_000));
  const identity = resolvePaperIdentity({
    arxivId: compact(embedded.arxivId) || paper.arxivId || inferred.arxivId,
    doi: compact(embedded.doi) || paper.doi || inferred.doi,
    id: paper.id,
    semanticScholarId: compact(embedded.semanticScholarId) || paper.semanticScholarId,
    title: paper.title
  });
  const identifiers = identity.candidates
    .filter((candidate): candidate is PaperIdentityCandidate & {
      kind: "doi" | "arxiv_id" | "semantic_scholar_id";
    } => candidate.kind === "doi" ||
      candidate.kind === "arxiv_id" ||
      candidate.kind === "semantic_scholar_id")
    .map(({ kind, value }) => ({ kind, value }));
  const authors = normalizeAuthors(embedded.authors);
  const title = (compact(embedded.title) || compact(paper.title)).slice(0, 1000);
  const year = normalizeYear(embedded.year);
  return {
    ...(authors.length > 0 ? { authors } : {}),
    ...(identifiers.length > 0 ? { identifiers } : {}),
    ...(title ? { title } : {}),
    ...(year ? { year } : {})
  };
}
