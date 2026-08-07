import { createRecommendationCacheClient, type RecommendationCacheTransport } from "./recommendationCacheClient";
import type {
  RecommendationCacheScope,
  RecommendationCacheLookupResult,
  RecommendationCachePutResult,
  RecommendationCacheClearResult
} from "./recommendationCache.types";
import type { RecommendationItem } from "./recommendation.types";

type RecommendationCacheRuntimeDeps = {
  transport?: RecommendationCacheTransport;
};

export async function getCloudRecommendationCache(
  input: {
    controlPlaneEndpoint: string;
    scope: RecommendationCacheScope;
  },
  deps: RecommendationCacheRuntimeDeps = {}
): Promise<RecommendationCacheLookupResult> {
  const client = createRecommendationCacheClient({
    endpoint: input.controlPlaneEndpoint,
    transport: deps.transport
  });

  return client.get(input.scope);
}

export async function putCloudRecommendationCache(
  input: {
    controlPlaneEndpoint: string;
    recommendations: RecommendationItem[];
    scope: RecommendationCacheScope;
  },
  deps: RecommendationCacheRuntimeDeps = {}
): Promise<RecommendationCachePutResult> {
  const client = createRecommendationCacheClient({
    endpoint: input.controlPlaneEndpoint,
    transport: deps.transport
  });

  return client.put(input.scope, input.recommendations);
}

export async function clearCloudRecommendationCache(
  input: {
    controlPlaneEndpoint: string;
    scope: RecommendationCacheScope;
  },
  deps: RecommendationCacheRuntimeDeps = {}
): Promise<RecommendationCacheClearResult> {
  const client = createRecommendationCacheClient({
    endpoint: input.controlPlaneEndpoint,
    transport: deps.transport
  });

  return client.clear(input.scope);
}
