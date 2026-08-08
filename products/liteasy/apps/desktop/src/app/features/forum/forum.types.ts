export type ForumPaperIdentity = {
  id: string;
  kind: "doi" | "arxiv_id" | "semantic_scholar_id" | "title_authors_year_hash";
  source: "inferred" | "metadata";
  value: string;
};

export type ForumLiteratureReference = {
  identity: ForumPaperIdentity;
  metadata: {
    authors: string[];
    documentType?: string;
    title: string;
    year?: number;
  };
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
  paperIdentity: ForumPaperIdentity;
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
