export type RecommendationItem = {
  abstract?: string;
  authors?: string[];
  canonicalId?: string;
  discoveredAt: string;
  id: string;
  identityResolution?: {
    aliases: string[];
    arxivId?: string;
    canonicalId: string;
    consistent: boolean;
    doi?: string;
    lineageEvidence?: {
      declaredBy: "arxiv";
      relation: "arxiv_declared_doi";
      sourceId: string;
      sourceRecordUrl?: string;
      targetId: string;
    };
    lineageStatus:
      | "possible_version_family"
      | "provider_declared_publication_link"
      | "same_identifier"
      | "single_record";
    providers: Array<"arxiv" | "crossref" | "openalex">;
    records: Array<{
      id: string;
      arxivId?: string;
      doi?: string;
      provider: "arxiv" | "crossref" | "openalex";
      recordUrl?: string;
      title: string;
      url: string;
      year?: number;
    }>;
    version: string;
  };
  openAccessAvailable?: boolean;
  publishedYear?: number;
  relatedDocumentTitle: string;
  relatedDocumentTitles?: string[];
  relation?: "cited_by_target" | "cites_target" | "related" | "topic_search";
  relevanceBand: "high" | "medium" | "low";
  relevanceScore: number;
  reason: string;
  qualityGate?: {
    checks: Record<string, boolean>;
    passed: boolean;
    reasons: string[];
    version: string;
  };
  rankingFusion?: {
    calibratedScore: number;
    fusionScore: number;
    k: number;
    routes: Array<{
      contribution: number;
      id: "lexical_bm25" | "personalization" | "provider" | "semantic";
      rank: number;
      score: number;
      weight: number;
    }>;
    version: string;
  };
  primaryProvider?: "arxiv" | "crossref" | "openalex";
  scoreComponents?: {
    baseRelevance: number;
    diversityPenalty: number;
    externalRerankerRelevance?: number;
    finalScore: number;
    fusionScore?: number;
    lexicalRelevance?: number;
    preference: number;
    preRerankerScore?: number;
    preFusionRelevance?: number;
    profileRelevance?: number;
    providerRelevance?: number;
    semanticRelevance?: number;
    sourceRelevance: number;
  };
  source: string;
  sourceKind: "cache" | "live" | "mock";
  sourceUrl?: string;
  surfacingTags?: string[];
  title: string;
  externalReranker?: {
    finalScore: number;
    originalScore: number;
    rank: number;
    relevanceScore: number;
    version: string;
    weight: number;
  };
};

export type RecommendationStatus =
  | "idle"
  | "unauthenticated"
  | "disabled"
  | "loading"
  | "ready"
  | "error";

export type RecommendationRequestDocument = {
  id: string;
  title: string;
};

export type RecommendationResearchProfile = {
  datasets: string[];
  languages: string[];
  methods: string[];
  topics: string[];
};
