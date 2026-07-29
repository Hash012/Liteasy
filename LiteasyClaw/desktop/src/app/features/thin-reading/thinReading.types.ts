import type {
  PaperIdentity,
  PaperIdentityCandidate,
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
  | {
      kind: "selected_text";
      evidenceIds?: readonly string[];
      externalSourceIds?: readonly string[];
      excerpt: string;
      prompt?: string;
    };

export type ThinReadingBranchSource = Exclude<ThinReadingNodeSource, { kind: "root_overview" }>;

export type ThinReadingRecommendationScope =
  | { kind: "whole_paper"; paperId?: string; paperIdentity?: PaperIdentity }
  | { kind: "section"; paperId?: string; paperIdentity?: PaperIdentity; sectionKey: string }
  | {
      kind: "selected_passage";
      evidenceIds?: readonly string[];
      externalSourceIds?: readonly string[];
      excerpt: string;
      paperId?: string;
      paperIdentity?: PaperIdentity;
    };

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
  // Agent-generated leads must never be presented as community recommendations.
  source?: "intuecho_community" | "local_agent_lead";
};

export type ThinReadingEvidenceSpan = {
  chunkId?: string;
  confidence: number;
  id: string;
  normalizedQuote?: string;
  page?: number;
  pageTextEnd?: number;
  pageTextStart?: number;
  textExtraction?: "embedded" | "ocr";
  paperId: string;
  quote: string;
};

export type ThinReadingExternalSource = {
  abstract: string;
  authors: readonly string[];
  arxivId?: string;
  doi?: string;
  id: string;
  isRetracted?: boolean;
  provider: "arxiv" | "crossref" | "openalex";
  relation: "cited_by_target" | "cites_target" | "related" | "topic_search";
  relevance: number;
  retrievalQuery: string;
  sourceRecordUrl: string;
  sourceId: string;
  title: string;
  url: string;
  year?: number;
};

export type ThinReadingClaimStatus = "grounded" | "unsupported" | "weak";

export type ThinReadingInterpretationIntent = "how" | "mixed" | "what" | "why";

export type ThinReadingInterpretationPlan = {
  discourseMoves: readonly string[];
  externalKnowledgeNeeded: boolean;
  externalQuery?: string;
  gap?: string;
  intent: ThinReadingInterpretationIntent;
  requestedDepth: "deep" | "standard";
};

export type ThinReadingClosureState = "inside_paper" | "near_boundary" | "outside_paper";

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

// This is deliberately attached to the generated node rather than the transient Agent run.
// A reader reopening an artifact must be able to inspect how its evidence boundary was chosen.
export type ThinReadingGenerationAudit = {
  interpretationPlan?: ThinReadingInterpretationPlan;
  evidenceLoop?: {
    rounds: readonly {
      focus: readonly string[];
      observedEvidenceIds: readonly string[];
      pageRequests: readonly number[];
      round: number;
      searchQueries: readonly string[];
      selectedEvidenceIds: readonly string[];
      toolCalls: readonly {
        evidenceIds: readonly string[];
        kind: "read" | "search" | "view";
        pages?: readonly number[];
        query?: string;
      }[];
    }[];
    stopReason: "maximum_rounds_reached" | "no_new_evidence" | "observation_sufficient";
    stopReasonDetail: string;
  };
  evidencePlan?: {
    focus: readonly string[];
    selectedEvidenceIds: readonly string[];
  };
  evidenceToolCalls?: readonly {
    evidenceIds: readonly string[];
    kind: "read" | "search" | "view";
    pages?: readonly number[];
    query?: string;
  }[];
  evidenceReview?: {
    reason: string;
    unsupportedSentenceIds: readonly string[];
    verdict: "pass";
  };
  model: {
    id: string;
    provider: string;
  };
  qualityGate: {
    attempts: number;
    repaired: boolean;
    repairReasons: readonly string[];
  };
  version: "liteasy.thin-reading-agent/v1" | "liteasy.thin-reading-agent/v2";
};

export type ThinReadingNodeEvidence = {
  claims?: readonly ThinReadingClaim[];
  externalKnowledge: readonly string[];
  externalSources?: readonly ThinReadingExternalSource[];
  generationAudit?: ThinReadingGenerationAudit;
  paperEvidence: readonly string[];
  paperEvidenceSpans?: readonly ThinReadingEvidenceSpan[];
  summarySentences?: readonly ThinReadingSummarySentence[];
};

export type ThinReadingNodeSeed = {
  closureState?: ThinReadingClosureState;
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
  primaryPaperIdentity?: PaperIdentityCandidate;
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
  interpretationPlan?: ThinReadingInterpretationPlan;
  selectedExternalSources?: readonly ThinReadingExternalSource[];
};

export type ThinReadingNode = {
  childIds: readonly string[];
  closureState?: ThinReadingClosureState;
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

export type ThinReadingAnnotationSyncState =
  | { error: string; lastAttemptAt: string; status: "failed" }
  | { intuechoAnnotationId: string; status: "synced"; syncedAt: string };

export type ThinReadingAnnotation = {
  artifactId: string;
  body: string;
  createdAt: string;
  excerpt: string;
  id: string;
  nodeId: string;
  target: ThinReadingAnnotationTarget;
  syncState?: ThinReadingAnnotationSyncState;
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
