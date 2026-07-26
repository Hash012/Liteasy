export type RecommendationItem = {
  discoveredAt: string;
  id: string;
  relatedDocumentTitle: string;
  relevanceBand: "high" | "medium" | "low";
  relevanceScore: number;
  reason: string;
  source: string;
  sourceKind: "cache" | "live" | "mock";
  sourceUrl?: string;
  title: string;
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
