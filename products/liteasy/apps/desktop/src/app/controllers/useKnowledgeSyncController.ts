import { useLocalRecommendations } from "../features/recommendations/useLocalRecommendations";
import { useRecommendationMetadataController } from "./useRecommendationMetadataController";
import type { PaperServiceConfig } from "../features/paper-services/paperServiceTransport";
import type { RecommendationRuntimeInput } from "../features/recommendations/recommendationRuntime";
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
  RecommendationStyle,
  RecommendationResearchProfile
} from "../features/recommendations/recommendation.types";
import type { RecommendationCacheScope } from "../features/recommendations/recommendationCache.types";
import type { RecommendationFeedbackTransport } from "../features/recommendations/recommendationFeedbackClient";

type UseKnowledgeSyncControllerInput = {
  localMode?: boolean;
  localService?: PaperServiceConfig;
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
    fetch: (input: RecommendationRuntimeInput) => Promise<RecommendationItem[]>;
  };
  recommendationTransport?: RecommendationTransport;
  recommendationsEnabled: boolean;
  recommendationSortMode: SettingsState["network.recommendation.sort_mode"];
  recommendationStyle?: RecommendationStyle;
  personalizationVersion?: number;
  personalizationEnabled: boolean;
  researchProfile?: RecommendationResearchProfile;
  selectedPapers: Paper[];
  prepareRecommendationPaper?: (paper: Paper) => Promise<Paper | undefined>;
  workspaceRevision: number;
  workspaceSourceKey: string;
};

export function useKnowledgeSyncController({
  localMode = false, localService,
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
  recommendationStyle,
  personalizationVersion,
  personalizationEnabled,
  researchProfile,
  selectedPapers,
  prepareRecommendationPaper,
  workspaceRevision,
  workspaceSourceKey
}: UseKnowledgeSyncControllerInput) {
  const directRecommendations = localMode || Boolean(localService);
  const metadata = useRecommendationMetadataController({ enabled: recommendationsEnabled,
    papers: selectedPapers, workspace: workspaceSourceKey, prepare: prepareRecommendationPaper });
  const cloudRecommendations = useRecommendations({
    accountSession,
    controlPlaneEndpoint,
    recommendationCacheDeps,
    recommendationCacheTransport,
    recommendationFeedbackTransport,
    recommendationGeneratorDeps,
    recommendationTransport,
    recommendationsEnabled: recommendationsEnabled && !directRecommendations && !metadata.blocked,
    recommendationSortMode,
    recommendationStyle,
    personalizationVersion,
    researchProfile,
    selectedPapers: metadata.papers,
    workspaceRevision,
    workspaceSourceKey
  });
  const localRecommendations = useLocalRecommendations({ enabled: directRecommendations && recommendationsEnabled && !metadata.blocked, config: localService,
    papers: metadata.papers, profile: researchProfile, workspace: workspaceSourceKey, style: recommendationStyle ?? "balanced", sort: recommendationSortMode });
  const recommendations = directRecommendations ? localRecommendations : cloudRecommendations;
  const documentMetadataSync = useDocumentMetadataSync({
    accountSession,
    controlPlaneEndpoint,
    documents,
    enabled: !localMode && personalizationEnabled && workspaceSourceKey.startsWith("local_library:"),
    transport: documentMetadataTransport,
    workspaceRevision
  });

  return {
    actions: {
      clearRecommendationCache: recommendations.clearRecommendationCache,
      refreshRecommendations: () => metadata.blocked ? metadata.retry() : recommendations.refreshRecommendations(),
      recordRecommendationSaved: (recommendation: RecommendationItem) =>
        recommendations.recordRecommendationFeedback(recommendation, "saved"),
      dismissRecommendation: (recommendation: RecommendationItem) =>
        recommendations.recordRecommendationFeedback(recommendation, "dismissed"),
      retryDocumentMetadataSync: documentMetadataSync.retrySync
    },
    model: {
      localRecommendations: directRecommendations,
      documentMetadataSyncMessage: documentMetadataSync.message,
      documentMetadataSyncResult: documentMetadataSync.lastResult,
      documentMetadataSyncStatus: documentMetadataSync.status,
      recommendationItems: metadata.blocked ? [] : recommendations.recommendationItems,
      recommendationMessage: metadata.blocked ? metadata.message : recommendations.recommendationMessage,
      recommendationPending: metadata.blocked ? metadata.pending : recommendations.recommendationPending,
      recommendationStatus: metadata.blocked ? metadata.pending ? "loading" as const : "error" as const : recommendations.recommendationStatus
    }
  };
}
