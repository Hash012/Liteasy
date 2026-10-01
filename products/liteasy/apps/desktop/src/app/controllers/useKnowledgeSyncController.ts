import { useContextRankedRecommendations } from "./useContextRankedRecommendations";
import { useRecommendationContextController, type RecommendationResourceInput } from "./useRecommendationContextController";
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
  recommendationResources?: RecommendationResourceInput;
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
  recommendationResources,
  prepareRecommendationPaper,
  workspaceRevision,
  workspaceSourceKey
}: UseKnowledgeSyncControllerInput) {
  const directRecommendations = localMode || Boolean(localService);
  const metadata = useRecommendationMetadataController({ enabled: recommendationsEnabled,
    papers: recommendationResources?.selected?.length ? [] : selectedPapers, workspace: workspaceSourceKey, prepare: prepareRecommendationPaper });
  const context = useRecommendationContextController({ enabled: recommendationsEnabled, papers: metadata.papers, resources: recommendationResources, profile: researchProfile });
  const cloudRecommendations = useRecommendations({
    accountSession,
    controlPlaneEndpoint,
    recommendationCacheDeps,
    recommendationCacheTransport,
    recommendationFeedbackTransport,
    recommendationGeneratorDeps,
    recommendationTransport,
    recommendationsEnabled: recommendationsEnabled && !directRecommendations && !metadata.blocked && !context.pending,
    recommendationSortMode,
    recommendationStyle,
    personalizationVersion,
    researchProfile: context.preferences.sendPrivateText && context.preferences.useProfile ? researchProfile : undefined,
    selectedDocuments: context.context.documents.filter((doc) => context.preferences.sendPrivateText || !context.context.views.find((view) => view.id === doc.id)?.private),
    selectedPapers: metadata.papers,
    workspaceRevision,
    workspaceSourceKey
  });
  const localRecommendations = useLocalRecommendations({ assets: recommendationResources?.assets, enabled: directRecommendations && recommendationsEnabled && !metadata.blocked, config: localService,
    papers: metadata.papers, profile: researchProfile, context: context.pending ? undefined : context.context, contextPending: context.pending, preferences: context.preferences, scopeId: recommendationResources?.scope ?? "local", workspace: workspaceSourceKey, style: recommendationStyle ?? "balanced", sort: recommendationSortMode });
  const cloudRanking = useContextRankedRecommendations({ assets: recommendationResources?.assets, enabled: !directRecommendations && recommendationsEnabled && context.preferences.hybridEnabled && !context.pending,
    items: cloudRecommendations.recommendationItems, context: context.context, preferences: context.preferences,
    scope: recommendationResources?.scope ?? "local", workspace: workspaceSourceKey, style: recommendationStyle ?? "balanced" });
  const recommendations = directRecommendations ? localRecommendations : context.preferences.hybridEnabled ? { ...cloudRecommendations,
    recommendationItems: cloudRanking.items, recommendationPending: cloudRecommendations.recommendationPending || cloudRanking.pending,
    recommendationMessage: [cloudRecommendations.recommendationMessage, cloudRanking.warning].filter(Boolean).join(" ") } : cloudRecommendations;
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
