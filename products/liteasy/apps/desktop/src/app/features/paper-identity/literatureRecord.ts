import { z } from "zod";

import { inferPaperIdentityMetadataFromPdfText, paperIdentityFromLiterature, resolvePaperIdentity } from "./paperIdentity";
import type { PaperIdentity, PaperIdentityCandidate } from "./paperIdentity";
import type { Paper } from "../workspace/workspace.types";
import type {
  LiteratureRecord,
  ReadableLiteratureSnapshot,
  LiteratureResolveInput,
  LiteratureSnapshot
} from "./literature.types";

const confirmableLiteratureIdentifierSchema = z.object({
  kind: z.enum([
    "doi",
    "arxiv_id",
    "semantic_scholar_id",
    "openalex_id"
  ]),
  role: z.literal("confirmable").optional(),
  source: z.literal("public_registry"),
  value: z.string().trim().min(1).max(1000)
}).strict().transform((identifier) => {
  return {
    ...identifier,
    role: "confirmable" as const,
    source: "public_registry" as const
  };
});
const candidateLiteratureAliasSchema = z.object({
  kind: z.literal("title_authors_year_hash"),
  role: z.literal("candidate_alias").optional(),
  source: z.enum(["metadata", "public_registry"]),
  value: z.string().trim().min(1).max(1000)
}).strict().transform((identifier) => ({
  ...identifier,
  role: "candidate_alias" as const,
  source: "metadata" as const
}));
const literatureIdentifierSchema = z.union([
  confirmableLiteratureIdentifierSchema,
  candidateLiteratureAliasSchema
]);
const literatureRecordSchema = z.object({
  authors: z.array(z.string().trim().min(1).max(300)).max(200),
  documentType: z.string().trim().min(1).max(100).optional(),
  identifiers: z.array(literatureIdentifierSchema).min(1).max(20),
  literatureId: z.string().trim().min(1).max(200),
  provenance: z.object({
    confirmedAt: z.string().datetime({ offset: true }),
    mode: z.literal("public_registry"),
    provider: z.enum(["intuecho", "openalex", "crossref", "arxiv", "semantic_scholar"]).optional()
  }).strict(),
  revision: z.number().int().positive(),
  status: z.literal("confirmed"),
  title: z.string().trim().min(1).max(1000),
  year: z.number().int().min(1000).max(9999).optional()
}).strict().superRefine((record, context) => {
  if (record.identifiers.every((identifier) => identifier.role === "candidate_alias")) {
    context.addIssue({
      code: "custom",
      message: "正式文献必须包含来源确认的稳定标识。",
      path: ["identifiers"]
    });
  }
});
const literatureSnapshotSchema = z.object({
  literature: literatureRecordSchema,
  version: z.literal(1)
}).strict();
const legacyLiteratureRecordSchema = z.object({
  authors: z.array(z.string().trim().min(1).max(300)).max(200).default([]),
  documentType: z.string().trim().min(1).max(100).optional(),
  identifiers: z.array(z.object({
    kind: z.enum(["doi", "arxiv_id", "semantic_scholar_id", "openalex_id", "title_authors_year_hash"]),
    source: z.enum(["inferred", "manual", "metadata"]),
    value: z.string().trim().min(1).max(1000)
  }).strict()).max(20).default([]),
  literatureId: z.string().trim().min(1).max(200),
  provenance: z.object({
    confirmedAt: z.string().nullable().optional(),
    mode: z.literal("manual"),
    provider: z.null().optional()
  }).passthrough().optional(),
  recordSource: z.enum(["legacy_metadata", "manual"]).optional(),
  revision: z.number().int().positive().optional(),
  status: z.literal("legacy_unverified").optional(),
  title: z.string().trim().min(1).max(1000),
  year: z.number().int().min(1000).max(9999).optional()
}).passthrough();
const readableLegacyLiteratureSnapshotSchema = z.object({
  literature: legacyLiteratureRecordSchema,
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

function commaSeparatedAuthors(value: string, preserveFamilyGivenPair: boolean): string[] {
  const parts = value.split(",").map(compact).filter(Boolean);
  if (parts.length <= 1) return parts;
  if (parts.length === 2) return preserveFamilyGivenPair ? [parts.join(", ")] : parts;
  if (parts.length % 2 === 0 && parts.every((part) => !/\s/u.test(part))) {
    return Array.from({ length: parts.length / 2 }, (_, index) =>
      `${parts[index * 2]}, ${parts[index * 2 + 1]}`
    );
  }
  return parts;
}

export function parsePdfAuthors(value: unknown): string[] {
  const isAuthorArray = Array.isArray(value);
  const values = isAuthorArray ? value : [value];
  return values.flatMap((item) => {
    if (typeof item !== "string") return [];
    const normalized = item.normalize("NFKC");
    const hasExplicitAuthorSeparator = /(?:;|\band\b|和|、|\r?\n+)/iu.test(normalized);
    return normalized
      .split(/\s*(?:;|\band\b|和|、|\r?\n+)\s*/iu)
      .flatMap((part) => commaSeparatedAuthors(part, isAuthorArray || hasExplicitAuthorSeparator));
  }).map(compact).filter(Boolean).slice(0, 200).map((author) => author.slice(0, 300));
}

function normalizeYear(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(compact(value));
  return Number.isInteger(number) && number >= 1000 && number <= 9999 ? number : undefined;
}

export function parsePmlrHint(value: unknown): NonNullable<
  NonNullable<LiteratureResolveInput["hints"]>["pmlr"]
> | undefined {
  const match = typeof value === "string"
    ? /\bPMLR\s+(\d{1,4})\s*,\s*(\d{4})\b/i.exec(value)
    : null;
  const volume = Number(match?.[1]);
  const year = Number(match?.[2]);
  if (!Number.isInteger(volume) || volume <= 0 || volume > 9999 ||
    !Number.isInteger(year) || year < 1000 || year > 9999) return undefined;
  return { source: "pmlr", volume, year };
}

export function normalizeLiteratureSnapshot(value: unknown): LiteratureSnapshot {
  const parsed = literatureSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("文献元数据快照无效。");
  }
  return parsed.data;
}

export function normalizeReadableLiteratureSnapshot(value: unknown): ReadableLiteratureSnapshot {
  const confirmed = literatureSnapshotSchema.safeParse(value);
  if (confirmed.success) return confirmed.data;
  const legacy = readableLegacyLiteratureSnapshotSchema.safeParse(value);
  if (!legacy.success) throw new Error("文献元数据快照无效。");
  const record = legacy.data.literature;
  return {
    literature: {
      authors: record.authors,
      ...(record.documentType ? { documentType: record.documentType } : {}),
      identifiers: record.identifiers,
      literatureId: record.literatureId,
      recordSource: record.recordSource ?? "manual",
      status: "legacy_unverified",
      title: record.title,
      ...(record.year ? { year: record.year } : {})
    },
    version: 1
  };
}

export function normalizeLiteratureRecord(value: unknown): LiteratureRecord {
  const parsed = literatureRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("文献元数据无效。");
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
  const authors = parsePdfAuthors(embedded.authors);
  const title = (compact(embedded.title) || compact(paper.title)).slice(0, 1000);
  const pmlr = parsePmlrHint((input.firstPageText ?? "").slice(0, 20_000));
  const year = normalizeYear(embedded.year) ?? pmlr?.year;
  return {
    ...(authors.length > 0 ? { authors } : {}),
    ...(identifiers.length > 0 ? { identifiers } : {}),
    ...(pmlr ? { pmlr } : {}),
    ...(title ? { title } : {}),
    ...(year ? { year } : {})
  };
}
