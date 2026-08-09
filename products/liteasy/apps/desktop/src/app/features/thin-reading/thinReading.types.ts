import type {
  PaperIdentity,
  PaperIdentityCandidate,
  PaperIdentityInput
} from "../paper-identity/paperIdentity";
import type { VisualizationArtifactV1, GeneratedVisualizationModality } from "../visualization/visualizationArtifact.types";

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

export type ThinReadingQuickCommand =
  | "html_algorithm_animation"
  | "html_svg_structure"
  | "mermaid_causal";

export type ThinReadingRequestedOutput = "explanation" | "html_demo" | "mermaid";

export type ThinReadingNodeSource =
  | { kind: "root_overview" }
  | { kind: "omitted_section"; label: string; sectionKey: string }
  | {
      kind: "selected_text";
      evidenceIds?: readonly string[];
      externalSourceIds?: readonly string[];
      excerpt: string;
      prompt?: string;
      quickCommand?: ThinReadingQuickCommand;
      requestedOutput?: ThinReadingRequestedOutput;
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
  textExtraction?: "embedded" | "mineru" | "ocr";
  paperId: string;
  quote: string;
};

export type ThinReadingExternalSource = {
  abstract: string;
  accessStatus?: "metadata_only" | "open_access" | "restricted" | "unknown";
  authors: readonly string[];
  arxivId?: string;
  canonicalPaperId?: string;
  citationCount?: number;
  /** Discrete provenance fact, kept apart from `relevance`: 1 the author cited it, 0.6 the
   *  citation graph derived it, 0.3 an algorithm retrieved it. Encoded as opacity, never as
   *  distance. */
  confidence?: number;
  confidenceBasis?:
    | "algorithmic_retrieval"
    | "author_citation"
    | "canonical_registry"
    | "citation_graph";
  doi?: string;
  evidenceBasis?: "abstract" | "full_text";
  fullTextEvidence?: readonly ThinReadingExternalEvidence[];
  fullTextGrantId?: string;
  fullTextUrl?: string;
  id: string;
  isRetracted?: boolean;
  /** Device-local cache coordinates. Browser sessions and metadata-only results omit them. */
  localPdfCachePath?: string;
  localPdfContentHash?: string;
  provider: "arxiv" | "crossref" | "doaj" | "oapen" | "openaire" | "openalex" | "semantic_scholar";
  relation:
    | "bibliographic_coupling"
    | "cited_by_target"
    | "cites_target"
    | "co_cited"
    | "related"
    | "topic_search";
  relevance: number;
  relationshipStrength?: number;
  referencesCount?: number;
  retrievalIntents?: readonly ("challenge" | "context" | "support")[];
  retrievalQueries?: readonly string[];
  retrievalQuery: string;
  sourceRecordUrl: string;
  sourceId: string;
  title: string;
  url: string;
  workType?: "article" | "book" | "chapter" | "dataset" | "other" | "preprint";
  year?: number;
};

export type ThinReadingExternalEvidence = {
  contentHash: string;
  finalUrl: string;
  id: string;
  page: number;
  pageTextEnd?: number;
  pageTextStart?: number;
  quote: string;
  textExtraction: "embedded";
};

export type ThinReadingPropositionVerdict =
  | "supported"
  | "partial"
  | "contradicted"
  | "insufficient";

export type ThinReadingClaimStatus = "grounded" | "unsupported" | "weak";

export type ThinReadingInterpretationIntent = "how" | "mixed" | "what" | "why";

export type ThinReadingLearningGoal =
  | "core_idea"
  | "field_position"
  | "paper_panorama"
  | "parent_continuity"
  | "selected_focus";

export type ThinReadingReadingMode = "exploration" | "orientation";

export type ThinReadingInterpretationPlan = {
  discourseMoves: readonly string[];
  externalKnowledgeNeeded: boolean;
  externalQuery?: string;
  gap?: string;
  intent: ThinReadingInterpretationIntent;
  // Optional only for artifacts created before reader-oriented planning was introduced.
  learningGoals?: readonly ThinReadingLearningGoal[];
  readingMode?: ThinReadingReadingMode;
  requestedDepth: "deep" | "standard";
};

export type ThinReadingFigureCandidate = {
  description?: string;
  id: string;
  importance?: "primary" | "reference" | "supporting";
  kind?: "architecture" | "chart" | "comparison" | "example" | "formula" | "other" | "result" | "table" | "workflow";
  page: number;
  placement?: "evidence" | "method" | "overview" | "results";
  title: string;
};

export type ThinReadingFigureRecommendation = {
  evidenceIds: readonly string[];
  figureId: string;
  reason: string;
};

export type ThinReadingInteractiveDemo = {
  description: string;
  html: string;
  kind: "html";
  title: string;
};

export type ThinReadingWorkloadAudit = {
  contextBudgetTokens: number;
  evidenceCharacters: number;
  evidenceCount: number;
  maxConcurrency: 0 | 1 | 2;
  plannedSubagents: readonly string[];
  reason: string;
  strategy: "direct" | "guided" | "parallel";
};

export type ThinReadingContextAudit = {
  droppedAncestors: number;
  droppedClaims: number;
  droppedEvidenceSpans: number;
  estimatedTokens: number;
  tokenBudget: number;
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

// Anchors belong to the reader-facing thin-reading text, rather than to an
// arbitrary position in the source PDF. Offsets keep the stored mapping exact
// even when the same phrase occurs more than once in a sentence.
export const thinReadingAnchorKinds = [
  "claim",
  "concept",
  "contribution",
  "limitation",
  "mechanism",
  "method",
  "result"
] as const;

export type ThinReadingAnchorKind = typeof thinReadingAnchorKinds[number];

export type ThinReadingAnchorQuality = {
  citationProvenance: number;
  evidenceAttention: number;
  evidenceCoverage: number;
  reason: string;
  score: number;
};

export type ThinReadingAnchor = {
  end: number;
  evidenceIds: readonly string[];
  externalSourceIds: readonly string[];
  id: string;
  importance: number;
  kind: ThinReadingAnchorKind;
  label: string;
  quality?: ThinReadingAnchorQuality;
  searchQuery: string;
  start: number;
  summarySentenceId: string;
  text: string;
};

export type ThinReadingRecommendationPaperEdge = {
  directed: boolean;
  evidenceRecordUrls: readonly string[];
  kind: "bibliographic_coupling" | "co_cited" | "direct_citation";
  provider: "openalex" | "semantic_scholar";
  sourcePaperId: string;
  strength: number;
  targetPaperId: string;
};

// This is deliberately attached to the generated node rather than the transient Agent run.
// A reader reopening an artifact must be able to inspect how its evidence boundary was chosen.
export type ThinReadingGenerationAudit = {
  contextManagement?: ThinReadingContextAudit;
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
    propositionVerdicts?: readonly {
      proposition: string;
      sentenceId: string;
      verdict: ThinReadingPropositionVerdict;
    }[];
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
  workload?: ThinReadingWorkloadAudit;
  version: "liteasy.thin-reading-agent/v1" | "liteasy.thin-reading-agent/v2";
};

export type ThinReadingNodeEvidenceV1 = {
  anchors?: readonly ThinReadingAnchor[];
  claims?: readonly ThinReadingClaim[];
  externalKnowledge: readonly string[];
  externalSources?: readonly ThinReadingExternalSource[];
  generationAudit?: ThinReadingGenerationAudit;
  interactiveDemo?: ThinReadingInteractiveDemo;
  // Mermaid is persisted next to the explanation it clarifies, so a reopened thin-reading
  // artifact retains both its source diagram and the reader's choice of visualization.
  mermaid?: string;
  recommendedFigures?: readonly ThinReadingFigureRecommendation[];
  paperEvidence: readonly string[];
  paperEvidenceSpans?: readonly ThinReadingEvidenceSpan[];
  recommendationPaperEdges?: readonly ThinReadingRecommendationPaperEdge[];
  summarySentences?: readonly ThinReadingSummarySentence[];
};

export type ThinReadingNodeEvidenceV2 = Omit<ThinReadingNodeEvidenceV1, "interactiveDemo" | "mermaid">;

/** V1 is accepted as a read-only persisted shape; new nodes use this v2 base. */
export type ThinReadingNodeEvidence = ThinReadingNodeEvidenceV1;

export type ThinReadingNodeSeed = {
  closureState?: ThinReadingClosureState;
  evidence: ThinReadingNodeEvidence;
  omittedSections: readonly ThinReadingSectionToken[];
  paperType?: ThinReadingPaperType;
  recommendations: readonly ThinReadingIntuechoRecommendation[];
  summary: string;
  withinPaperClosure: boolean;
};

export type ThinReadingAncestorSummary = {
  nodeId: string;
  summary: string;
  title: string;
};

export type ThinReadingGenerationContext = {
  ancestorSummaries?: readonly ThinReadingAncestorSummary[];
  availableFigures?: readonly ThinReadingFigureCandidate[];
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

export type ThinReadingNodeBase<Evidence extends ThinReadingNodeEvidenceV1 = ThinReadingNodeEvidenceV1> = {
  childIds: readonly string[];
  closureState?: ThinReadingClosureState;
  createdAt: string;
  depth: number;
  id: string;
  evidence: Evidence;
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

export type VisualizationIntentV1 = {
  candidateModalities: readonly GeneratedVisualizationModality[];
  evidenceIds: readonly string[];
  expectedLearningGain: "low" | "medium" | "high";
  nodeId: string;
  purpose: "explain_structure" | "compare" | "show_process" | "show_geometry" | "show_evidence";
  requestedBy: "automatic" | "explicit_user_request";
};

export type VisualizationDecisionV1 = {
  intent: VisualizationIntentV1;
  reasonCode?: string;
  status: "accepted" | "omitted";
};

export type ThinReadingNodeV1 = ThinReadingNodeBase<ThinReadingNodeEvidenceV1> & {
  version?: "liteasy.thin-reading/v1";
};

export type ThinReadingNodeV2 = ThinReadingNodeBase<ThinReadingNodeEvidenceV2> & {
  visualizationDecision?: VisualizationDecisionV1;
  visualizations: readonly VisualizationArtifactV1[];
};

export type ThinReadingNode = ThinReadingNodeV1 | ThinReadingNodeV2;

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

export type ThinReadingDocumentBase<Node extends ThinReadingNode = ThinReadingNode> = {
  annotationSettings: ThinReadingAnnotationSettings;
  annotations: readonly ThinReadingAnnotation[];
  artifactId: string;
  paperIdentities?: Readonly<Record<string, PaperIdentity>>;
  paperIds: readonly string[];
  title: string;
  targetLanguage: string;
  activeNodeId: string;
  nodes: Readonly<Record<string, Node>>;
  pendingPublicAnnotationIds: readonly string[];
  rootNodeId: string;
};

export type ThinReadingDocumentV1 = ThinReadingDocumentBase<ThinReadingNodeV1> & {
  version: "liteasy.thin-reading/v1";
};

export type ThinReadingDocumentV2 = ThinReadingDocumentBase<ThinReadingNodeV2> & {
  migrationProvenance?: {
    migratedAt: string;
    sourceArtifactId: string;
  };
  version: "liteasy.thin-reading/v2";
};

export type ThinReadingDocument = ThinReadingDocumentV1 | ThinReadingDocumentV2;

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
