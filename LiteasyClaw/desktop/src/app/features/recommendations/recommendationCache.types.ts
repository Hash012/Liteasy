import type { RecommendationItem } from "./recommendation.types";

export type RecommendationCacheScope = {
  selectionKey: string;
  sessionId: string;
  sortMode: "relevance" | "retrieved_at";
  workspaceKey: string;
};

export type RecommendationCacheLookupResult = {
  cacheHit: boolean;
  recommendations: RecommendationItem[];
};

export type RecommendationCachePutResult = {
  cachedAt: string;
  ok: true;
};

export type RecommendationCacheClearResult = {
  cleared: boolean;
};
