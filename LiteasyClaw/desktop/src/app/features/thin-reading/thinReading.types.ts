import type {
  PaperIdentity,
  PaperIdentityInput
} from "../paper-identity/paperIdentity";

export type ThinReadingPaper = PaperIdentityInput;

export type ThinReadingPaperType =
  | "benchmark"
  | "dataset"
  | "experimental"
  | "humanities"
  | "position"
  | "survey"
  | "systems"
  | "theoretical"
  | "unknown";

export type ThinReadingNodeSource =
  | { kind: "root_overview" }
  | { kind: "omitted_section"; label: string; sectionKey: string }
  | { kind: "selected_text"; excerpt: string; prompt?: string };

export type ThinReadingBranchSource = Exclude<ThinReadingNodeSource, { kind: "root_overview" }>;

export type ThinReadingRecommendationScope =
  | { kind: "whole_paper"; paperId?: string; paperIdentity?: PaperIdentity }
  | { kind: "section"; paperId?: string; paperIdentity?: PaperIdentity; sectionKey: string }
  | { kind: "selected_passage"; paperId?: string; paperIdentity?: PaperIdentity; excerpt: string };

export type ThinReadingSectionToken = {
  id: string;
  label: string;
  sectionKey: string;
};

export type ThinReadingIntuechoRecommendation = {
  id: string;
  compatibility: number;
  note: string;
  relationship: string;
};

export type ThinReadingEvidenceSpan = {
  chunkId?: string;
  confidence: number;
  id: string;
  normalizedQuote?: string;
  page?: number;
  paperId: string;
  quote: string;
};

export type ThinReadingExternalSource = {
  abstract: string;
  authors: readonly string[];
  doi?: string;
  id: string;
  provider: "openalex";
  relevance: number;
  retrievalQuery: string;
  sourceId: string;
  title: string;
  url: string;
  year?: number;
};

export type ThinReadingClaimStatus = "grounded" | "unsupported" | "weak";

export type ThinReadingClaim = {
  evidenceIds: readonly string[];
  id: string;
  status: ThinReadingClaimStatus;
  text: string;
};

export type ThinReadingSummarySentence = {
  evidenceIds: readonly string[];
  externalKnowledge: readonly string[];
  id: string;
  status: ThinReadingClaimStatus;
  text: string;
};

export type ThinReadingNodeEvidence = {
  claims?: readonly ThinReadingClaim[];
  externalKnowledge: readonly string[];
  externalSources?: readonly ThinReadingExternalSource[];
  paperEvidence: readonly string[];
  paperEvidenceSpans?: readonly ThinReadingEvidenceSpan[];
  summarySentences?: readonly ThinReadingSummarySentence[];
};

export type ThinReadingNodeSeed = {
  evidence: ThinReadingNodeEvidence;
  omittedSections: readonly ThinReadingSectionToken[];
  paperType?: ThinReadingPaperType;
  recommendations: readonly ThinReadingIntuechoRecommendation[];
  summary: string;
  withinPaperClosure: boolean;
};

export type ThinReadingGenerationContext = {
  artifactId: string;
  depth: number;
  paperIds: readonly string[];
  primaryPaperId?: string;
  primaryPaperTitle?: string;
  prompt?: string;
  parentClaims?: readonly ThinReadingClaim[];
  parentEvidenceSpans?: readonly ThinReadingEvidenceSpan[];
  parentWithinPaperClosure?: boolean;
  parentNodeId?: string;
  parentSummary?: string;
  parentTitle?: string;
  source: ThinReadingNodeSource;
  targetLanguage: string;
  externalSources?: readonly ThinReadingExternalSource[];
};

export type ThinReadingNode = {
  childIds: readonly string[];
  createdAt: string;
  depth: number;
  id: string;
  evidence: ThinReadingNodeEvidence;
  omittedSections: readonly ThinReadingSectionToken[];
  paperType?: ThinReadingPaperType;
  parentId?: string;
  recommendationScope: ThinReadingRecommendationScope;
  recommendations: readonly ThinReadingIntuechoRecommendation[];
  source: ThinReadingNodeSource;
  summary: string;
  title: string;
  withinPaperClosure: boolean;
};

export type ThinReadingAnnotationTarget =
  | { claimId: string; kind: "claim"; nodeId: string }
  | { kind: "node_summary"; nodeId: string }
  | { kind: "paper_evidence"; evidence: string; nodeId: string }
  | { kind: "external_knowledge"; nodeId: string; source: string }
  | { kind: "recommendation"; nodeId: string; recommendationId: string };

export type ThinReadingAnnotationVisibility = "private" | "pending_public";

export type ThinReadingAnnotation = {
  artifactId: string;
  body: string;
  createdAt: string;
  excerpt: string;
  id: string;
  nodeId: string;
  target: ThinReadingAnnotationTarget;
  updatedAt: string;
  visibility: ThinReadingAnnotationVisibility;
};

export type ThinReadingAnnotationSettings = {
  autoPublic: boolean;
};

export type ThinReadingDocument = {
  annotationSettings: ThinReadingAnnotationSettings;
  annotations: readonly ThinReadingAnnotation[];
  artifactId: string;
  paperIdentities?: Readonly<Record<string, PaperIdentity>>;
  paperIds: readonly string[];
  title: string;
  targetLanguage: string;
  activeNodeId: string;
  nodes: Readonly<Record<string, ThinReadingNode>>;
  pendingPublicAnnotationIds: readonly string[];
  rootNodeId: string;
  version: "liteasy.thin-reading/v1";
};

export type CreateThinReadingDocumentInput = {
  artifactId: string;
  papers: readonly ThinReadingPaper[];
  rootSeed: ThinReadingNodeSeed;
  targetLanguage: string;
  importedChunksByPaperId?: Readonly<Record<string, readonly string[]>>;
};

export type AdvanceThinReadingDocumentInput = {
  parentNodeId: string;
  source: ThinReadingBranchSource;
  seed: ThinReadingNodeSeed;
  title: string;
  createdAt?: string;
};
