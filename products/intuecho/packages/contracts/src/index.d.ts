import type { z } from "zod";

export type LiteratureIdentifierKind =
  | "doi"
  | "arxiv_id"
  | "semantic_scholar_id"
  | "openalex_id"
  | "title_authors_year_hash";

export type LiteratureSource = "public_registry" | "manual" | "inferred";

export type LiteratureIdentifier = {
  kind: LiteratureIdentifierKind;
  source: LiteratureSource;
  value: string;
};

export type LiteratureCandidate = {
  candidateKey: string;
  provider: "intuecho" | "openalex" | "crossref" | "arxiv" | "semantic_scholar";
  record: {
    authors: string[];
    documentType?: string;
    identifiers: LiteratureIdentifier[];
    title: string;
    year?: number;
  };
};

export type ManualLiteratureInput = {
  authors: string[];
  documentType?: string;
  identifiers: Array<{
    kind: "doi" | "arxiv_id" | "semantic_scholar_id" | "openalex_id";
    source: "manual";
    value: string;
  }>;
  title: string;
  year?: number;
};

export type LiteratureRecord = {
  authors: string[];
  documentType?: string;
  identifiers: LiteratureIdentifier[];
  literatureId: string;
  provenance: {
    confirmedAt: string;
    mode: "public_registry" | "manual";
    provider?: "intuecho" | "openalex" | "crossref" | "arxiv" | "semantic_scholar";
  };
  title: string;
  year?: number;
};

export type LiteratureResolveInput = {
  hints?: {
    authors?: string[];
    identifiers?: Array<{ kind: LiteratureIdentifierKind; value: string }>;
    title?: string;
    year?: number;
  };
  limit?: number;
  purpose: "forum_compose" | "liteasy_pdf_annotation";
  query?: string;
};

export type LiteratureConfirmInput =
  | { candidateKey: string; mode: "candidate" }
  | { mode: "manual"; record: ManualLiteratureInput };

export type ConfirmedLiteratureReference = { literatureId: string };

export type PaperIdentity = {
  id: string;
  kind: "doi" | "arxiv_id" | "semantic_scholar_id" | "title_authors_year_hash";
  source: "inferred" | "metadata";
  value: string;
};

export type LegacyLiteratureReference = {
  identity: PaperIdentity;
  metadata: {
    authors: string[];
    documentType?: string;
    title: string;
    year?: number;
  };
};

export type LiteratureReference = ConfirmedLiteratureReference | LegacyLiteratureReference;

export type SourcePassage = {
  anchorHash: string;
  excerpt: string;
  page?: number;
  rects: Array<Record<string, unknown>>;
};

export type SourceEvidence = SourcePassage & {
  literature: LiteratureReference;
};

export type AnnotationTarget =
  | { kind: "whole_document"; literature: LiteratureReference }
  | ({ kind: "source_passage" } & SourceEvidence)
  | {
      derivedContent: {
        artifactId: string;
        excerpt: string;
        nodeId?: string;
        version: string;
      };
      evidence: SourceEvidence[];
      kind: "derived_passage";
      literature: LiteratureReference;
    };

export type DesktopAnnotationPublicationOperation =
  | ({
      body: string;
      literatureId: string;
      operation: "upsert";
      sourcePassage: SourcePassage;
    } & {
      annotationId: string;
      queueKey: string;
      revision: number;
      updatedAt: string;
    })
  | ({
      operation: "retract";
      remoteAnnotationId: string;
    } & {
      annotationId: string;
      queueKey: string;
      revision: number;
      updatedAt: string;
    });

export type DesktopAnnotationPublicationBatch = {
  operations: DesktopAnnotationPublicationOperation[];
};

export declare const literatureIdentifierKindSchema: z.ZodType<LiteratureIdentifierKind>;
export declare const literatureSourceSchema: z.ZodType<LiteratureSource>;
export declare const literatureIdentifierSchema: z.ZodType<LiteratureIdentifier>;
export declare const literatureCandidateSchema: z.ZodType<LiteratureCandidate>;
export declare const manualLiteratureInputSchema: z.ZodType<ManualLiteratureInput>;
export declare const literatureRecordSchema: z.ZodType<LiteratureRecord>;
export declare const literatureResolveInputSchema: z.ZodType<LiteratureResolveInput>;
export declare const literatureConfirmInputSchema: z.ZodType<LiteratureConfirmInput>;
export declare const confirmedLiteratureReferenceSchema: z.ZodType<ConfirmedLiteratureReference>;
export declare const literatureReferenceSchema: z.ZodType<LiteratureReference>;
export declare const annotationTargetSchema: z.ZodType<AnnotationTarget>;
export declare const desktopAnnotationPublicationBatchSchema: z.ZodType<DesktopAnnotationPublicationBatch>;

export declare const contextualDraftSchema: z.ZodType<unknown>;
export declare const updateDraftSchema: z.ZodType<unknown>;
export declare const createPostSchema: z.ZodType<unknown>;
export declare const createTopicSchema: z.ZodType<unknown>;
export declare const signalSchema: z.ZodType<unknown>;
export declare const annotationRatingSchema: z.ZodType<unknown>;
export declare const createFeedbackSchema: z.ZodType<unknown>;
export declare const paperIdentitySchema: z.ZodType<PaperIdentity>;
export declare const communityAnnotationSchema: z.ZodType<unknown>;
export declare const communityAnnotationBatchSchema: z.ZodType<unknown>;
export declare const communityRecommendationQuerySchema: z.ZodType<unknown>;
export declare const desktopDraftHandoffSchema: z.ZodType<unknown>;
export declare const annotationVisibilitySchema: z.ZodType<"private" | "organization" | "mutual_followers" | "public">;
export declare const literatureMetadataSchema: z.ZodType<LegacyLiteratureReference["metadata"]>;
export declare const createAnnotationSchema: z.ZodType<unknown>;
export declare const updateAnnotationSchema: z.ZodType<unknown>;
export declare const academicProfileSchema: z.ZodType<unknown>;
export declare const createReplySchema: z.ZodType<unknown>;
export declare const updateReplySchema: z.ZodType<unknown>;
export declare const followUserSchema: z.ZodType<unknown>;
export declare const createConversationSchema: z.ZodType<unknown>;
export declare const markConversationReadSchema: z.ZodType<unknown>;
export declare const sendMessageSchema: z.ZodType<unknown>;
export declare const tagAppealSchema: z.ZodType<unknown>;
export declare const tagAppealResolutionSchema: z.ZodType<unknown>;
export declare const annotationModerationSchema: z.ZodType<unknown>;
export declare const desktopAnnotationHandoffSchema: z.ZodType<unknown>;
export declare const desktopCommunityAnnotationSchema: z.ZodType<unknown>;
export declare const desktopCommunityAnnotationBatchSchema: z.ZodType<unknown>;
