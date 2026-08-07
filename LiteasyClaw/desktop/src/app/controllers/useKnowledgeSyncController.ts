import { useDocumentMetadataSync } from "../features/metadata/useDocumentMetadataSync";
import type { DocumentMetadataTransport } from "../features/metadata/documentMetadataClient";
import { useRecommendations } from "../features/recommendations/useRecommendations";
import type { RecommendationTransport } from "../features/recommendations/recommendationClient";
import type { RecommendationCacheTransport } from "../features/recommendations/recommendationCacheClient";
import type { AccountSession } from "../features/account/account.types";
import type { SettingsState } from "../features/settings/settings.types";
import type { Paper } from "../features/workspace/workspace.types";
import type {
  RecommendationItem,
  RecommendationResearchProfile
} from "../features/recommendations/recommendation.types";
import type { RecommendationCacheScope } from "../features/recommendations/recommendationCache.types";
import type { RecommendationFeedbackTransport } from "../features/recommendations/recommendationFeedbackClient";

type UseKnowledgeSyncControllerInput = {
  accountSession: AccountSession | null;
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
  recommendationFeedbackTransport?: RecommendationFeedbackTransport;
  recommendationGeneratorDeps?: {
    fetch: (input: {
      controlPlaneEndpoint: string;
      researchProfile?: RecommendationResearchProfile;
      selectedDocuments: Array<{ id: string; title: string }>;
      sessionId: string;
      sortMode: SettingsState["network.recommendation.sort_mode"];
    }) => Promise<RecommendationItem[]>;
  };
  recommendationTransport?: RecommendationTransport;
  recommendationsEnabled: boolean;
  recommendationSortMode: SettingsState["network.recommendation.sort_mode"];
  personalizationVersion?: number;
  personalizationEnabled: boolean;
  researchProfile?: RecommendationResearchProfile;
  selectedPapers: Paper[];
  workspaceRevision: number;
  workspaceSourceKey: string;
};

export function useKnowledgeSyncController({
  accountSession,
  controlPlaneEndpoint,
  documentMetadataTransport,
  documents,
  recommendationCacheDeps,
  recommendationCacheTransport,
  recommendationFeedbackTransport,
  recommendationGeneratorDeps,
  recommendationTransport,
  recommendationsEnabled,
  recommendationSortMode,
  personalizationVersion,
  personalizationEnabled,
  researchProfile,
  selectedPapers,
  workspaceRevision,
  workspaceSourceKey
}: UseKnowledgeSyncControllerInput) {
  const recommendations = useRecommendations({
    accountSession,
    controlPlaneEndpoint,
    recommendationCacheDeps,
    recommendationCacheTransport,
    recommendationFeedbackTransport,
    recommendationGeneratorDeps,
    recommendationTransport,
    recommendationsEnabled,
    recommendationSortMode,
    personalizationVersion,
    researchProfile,
    selectedPapers,
    workspaceRevision,
    workspaceSourceKey
  });
  const documentMetadataSync = useDocumentMetadataSync({
    accountSession,
    controlPlaneEndpoint,
    documents,
    enabled: personalizationEnabled && workspaceSourceKey.startsWith("local_library:"),
    transport: documentMetadataTransport,
    workspaceRevision
  });

  return {
    actions: {
      clearRecommendationCache: recommendations.clearRecommendationCache,
      recordRecommendationSaved: (recommendation: RecommendationItem) =>
        recommendations.recordRecommendationFeedback(recommendation, "saved"),
      dismissRecommendation: (recommendation: RecommendationItem) =>
        recommendations.recordRecommendationFeedback(recommendation, "dismissed"),
      retryDocumentMetadataSync: documentMetadataSync.retrySync
    },
    model: {
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
