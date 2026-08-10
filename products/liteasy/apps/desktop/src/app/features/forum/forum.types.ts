import type {
  LiteratureConfirmInput,
  LiteratureRecord,
  LiteratureRelationsResult,
  LiteratureResolveInput,
  LiteratureResolveResult
} from "../paper-identity/literature.types";

export type ForumPaperIdentity = {
  id: string;
  kind: "doi" | "arxiv_id" | "semantic_scholar_id" | "openalex_id" | "title_authors_year_hash";
  source: "inferred" | "metadata";
  value: string;
};

export type ForumLiteratureReference = {
  literatureId: string;
};

export type ForumAnnotationTarget =
  | { kind: "whole_document"; literature: ForumLiteratureReference }
  | {
      anchorHash: string;
      excerpt: string;
      kind: "source_passage";
      literature: ForumLiteratureReference;
      page?: number;
      rects: Array<Record<string, unknown>>;
    }
  | {
      derivedContent: {
        artifactId: string;
        excerpt: string;
        nodeId?: string;
        version: string;
      };
      evidence: Array<{
        anchorHash: string;
        excerpt: string;
        literature: ForumLiteratureReference;
        page?: number;
        rects: Array<Record<string, unknown>>;
      }>;
      kind: "derived_passage";
      literature: ForumLiteratureReference;
    };

export type ForumContext = {
  body?: string;
  organizationId?: string;
  shareToPlaza?: boolean;
  tags?: string[];
  targets: ForumAnnotationTarget[];
  visibility?: "private" | "organization" | "mutual_followers" | "public";
};

export type ForumDraftUpdate = {
  body: string;
  tags?: string[];
};

export type ForumFeedQuery = {
  anchorHash?: string;
  literatureId: string;
};

export type ForumPost = {
  author_name: string;
  body: string;
  created_at: string;
  helpful: number;
  id: string;
  tags: string[];
  title: string | null;
  viewer_saved: boolean;
  work_id: string | null;
};

export type ForumLiteratureResolveInput = LiteratureResolveInput;
export type ForumLiteratureResolveResult = LiteratureResolveResult;
export type ForumLiteratureConfirmInput = LiteratureConfirmInput;
export type ForumLiteratureConfirmResult = { literature: LiteratureRecord };
export type ForumLiteratureRelationsResult = LiteratureRelationsResult;

type ForumAnnotationPublicationOperationBase = {
  annotationId: string;
  queueKey: string;
  revision: number;
  updatedAt: string;
};

export type ForumAnnotationPublicationOperation =
  | (ForumAnnotationPublicationOperationBase & {
      body: string;
      literatureId: string;
      operation: "upsert";
      sourcePassage: {
        anchorHash: string;
        excerpt: string;
        page?: number;
        rects: Array<{ height: number; left: number; top: number; width: number }>;
      };
    })
  | (ForumAnnotationPublicationOperationBase & {
      operation: "retract";
      remoteAnnotationId: string;
    });

export type ForumAnnotationPublicationReceipt = {
  annotationId: string;
  queueKey: string;
  remoteAnnotationId: string;
  remoteRevision: number;
  sourceRevision: number;
  state: "published" | "retracted";
  syncedAt: string;
};

export type ForumAnnotationPublicationFailure = {
  annotationId: string;
  code?: string;
  error: string;
  message?: string;
  pendingOperation: ForumAnnotationPublicationOperation;
  queueKey: string;
  state: "failed";
};

export type ForumAnnotationPublicationResult =
  | ForumAnnotationPublicationReceipt
  | ForumAnnotationPublicationFailure;
