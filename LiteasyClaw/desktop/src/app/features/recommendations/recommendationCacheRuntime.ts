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

function isMockEndpoint(endpoint: string) {
  return endpoint.startsWith("mock://");
}

export async function getCloudRecommendationCache(
  input: {
    controlPlaneEndpoint: string;
    scope: RecommendationCacheScope;
  },
  deps: RecommendationCacheRuntimeDeps = {}
): Promise<RecommendationCacheLookupResult> {
  if (isMockEndpoint(input.controlPlaneEndpoint)) {
    return {
      cacheHit: false,
      recommendations: []
    };
  }

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
  if (isMockEndpoint(input.controlPlaneEndpoint)) {
    return {
      cachedAt: new Date().toISOString(),
      ok: true
    };
  }

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
  if (isMockEndpoint(input.controlPlaneEndpoint)) {
    return {
      cleared: true
    };
  }

  const client = createRecommendationCacheClient({
    endpoint: input.controlPlaneEndpoint,
    transport: deps.transport
  });

  return client.clear(input.scope);
}
