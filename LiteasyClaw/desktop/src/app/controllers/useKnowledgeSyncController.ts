import { useCollectionItems } from "../features/collection/useCollectionItems";
import type { CollectionTransport } from "../features/collection/collectionClient";
import { useDocumentMetadataSync } from "../features/metadata/useDocumentMetadataSync";
import type { DocumentMetadataTransport } from "../features/metadata/documentMetadataClient";
import { useRecommendations } from "../features/recommendations/useRecommendations";
import type { RecommendationTransport } from "../features/recommendations/recommendationClient";
import type { RecommendationCacheTransport } from "../features/recommendations/recommendationCacheClient";
import type { AccountSession } from "../features/account/account.types";
import type { SettingsState } from "../features/settings/settings.types";
import type { Paper } from "../features/workspace/workspace.types";
import type { RecommendationItem } from "../features/recommendations/recommendation.types";
import type { RecommendationCacheScope } from "../features/recommendations/recommendationCache.types";

type UseKnowledgeSyncControllerInput = {
  accountSession: AccountSession | null;
  collectionTransport?: CollectionTransport;
  controlPlaneEndpoint: string;
  documentMetadataTransport?: DocumentMetadataTransport;
  documents: Paper[];
  recommendationCacheDeps?: {
    clear: (scope: RecommendationCacheScope) => Promise<{ cleared: boolean }>;
    get: (scope: RecommendationCacheScope) => Promise<{
      cacheHit: boolean;
      recommendations: RecommendationItem[];
    }>;
    put: (
      scope: RecommendationCacheScope,
      recommendations: RecommendationItem[]
    ) => Promise<{ cachedAt: string; ok: true }>;
  };
  recommendationCacheTransport?: RecommendationCacheTransport;
  recommendationGeneratorDeps?: {
    fetch: (input: {
      controlPlaneEndpoint: string;
      selectedDocuments: Array<{ id: string; title: string }>;
      sessionId: string;
      sortMode: SettingsState["network.recommendation.sort_mode"];
    }) => Promise<RecommendationItem[]>;
  };
  recommendationTransport?: RecommendationTransport;
  recommendationsEnabled: boolean;
  recommendationSortMode: SettingsState["network.recommendation.sort_mode"];
  personalizationVersion?: number;
  selectedPapers: Paper[];
  workspaceRevision: number;
  workspaceSourceKey: string;
};

export function useKnowledgeSyncController({
  accountSession,
  collectionTransport,
  controlPlaneEndpoint,
  documentMetadataTransport,
  documents,
  recommendationCacheDeps,
  recommendationCacheTransport,
  recommendationGeneratorDeps,
  recommendationTransport,
  recommendationsEnabled,
  recommendationSortMode,
  personalizationVersion,
  selectedPapers,
  workspaceRevision,
  workspaceSourceKey
}: UseKnowledgeSyncControllerInput) {
  const collection = useCollectionItems({
    accountSession,
    controlPlaneEndpoint,
    transport: collectionTransport
  });
  const recommendations = useRecommendations({
    accountSession,
    controlPlaneEndpoint,
    recommendationCacheDeps,
    recommendationCacheTransport,
    recommendationGeneratorDeps,
    recommendationTransport,
    recommendationsEnabled,
    recommendationSortMode,
    personalizationVersion,
    selectedPapers,
    workspaceRevision,
    workspaceSourceKey
  });
  const documentMetadataSync = useDocumentMetadataSync({
    accountSession,
    controlPlaneEndpoint,
    documents,
    transport: documentMetadataTransport,
    workspaceRevision
  });

  return {
    actions: {
      clearRecommendationCache: recommendations.clearRecommendationCache,
      collectRecommendation: collection.collectRecommendation,
      dismissRecommendation: recommendations.dismissRecommendation,
      retryCollectionSync: collection.retry,
      retryDocumentMetadataSync: documentMetadataSync.retrySync
    },
    model: {
      collectionItems: collection.collectionItems,
      collectionMessage: collection.message,
      collectionStatus: collection.status,
      documentMetadataSyncMessage: documentMetadataSync.message,
      documentMetadataSyncResult: documentMetadataSync.lastResult,
      documentMetadataSyncStatus: documentMetadataSync.status,
      recommendationItems: recommendations.recommendationItems,
      recommendationMessage: recommendations.recommendationMessage,
      recommendationPending: recommendations.recommendationPending,
      recommendationStatus: recommendations.recommendationStatus
    }
  };
}
