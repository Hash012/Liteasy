import { useState } from "react";
import { useRecommendationFeed } from "../features/recommendations/useRecommendationFeed";
import { useRecommendationContextController, type RecommendationResourceInput } from "./useRecommendationContextController";
import { hasRecommendationMetadata, useRecommendationMetadataController } from "./useRecommendationMetadataController";
import type { PaperServiceConfig } from "../features/paper-services/paperServiceTransport";
import type { RecommendationRuntimeInput } from "../features/recommendations/recommendationRuntime";
import { useDocumentMetadataSync } from "../features/metadata/useDocumentMetadataSync";
import type { DocumentMetadataTransport } from "../features/metadata/documentMetadataClient";
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
  const [seed, setSeed] = useState<{ workspace: string; id: string; papers: Paper[]; resources?: RecommendationResourceInput }>();
  const activeSeed = seed?.workspace === workspaceSourceKey ? seed : undefined;
  const metadata = useRecommendationMetadataController({ enabled: recommendationsEnabled,
    papers: activeSeed?.papers ?? documents.filter(hasRecommendationMetadata).slice(0, 16), workspace: workspaceSourceKey, prepare: activeSeed ? prepareRecommendationPaper : undefined });
  const context = useRecommendationContextController({ enabled: recommendationsEnabled, papers: metadata.papers,
    resources: activeSeed?.resources ?? (recommendationResources ? { ...recommendationResources, selected: [] } : undefined), profile: researchProfile });
  const recommendations = useRecommendationFeed({ enabled: recommendationsEnabled, direct: directRecommendations,
    accountSession, endpoint: controlPlaneEndpoint, scope: recommendationResources?.scope ?? "local", workspace: workspaceSourceKey,
    context: context.context, pending: context.pending || metadata.blocked, preferences: context.preferences, profile: researchProfile,
    style: recommendationStyle ?? "balanced", config: localService, assets: recommendationResources?.assets,
    transport: recommendationTransport, feedbackTransport: recommendationFeedbackTransport, generator: recommendationGeneratorDeps,
    legacyCache: recommendationCacheDeps, seedId: activeSeed?.id });
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
      exploreSelectedPapers: () => setSeed({ workspace: workspaceSourceKey, id: crypto.randomUUID(), papers: [...selectedPapers], resources: recommendationResources ? { ...recommendationResources, selected: [...(recommendationResources.selected ?? [])] } : undefined }),
      showOrdinaryRecommendations: () => setSeed(undefined),
      acceptPendingRecommendations: recommendations.acceptPending,
      recordRecommendationSaved: (recommendation: RecommendationItem) =>
        recommendations.recordRecommendationFeedback(recommendation, "saved"),
      dismissRecommendation: (recommendation: RecommendationItem) =>
        recommendations.recordRecommendationFeedback(recommendation, "dismissed"),
      retryDocumentMetadataSync: documentMetadataSync.retrySync
    },
    model: {
      localRecommendations: directRecommendations,
      recommendationPendingSnapshot: recommendations.pendingSnapshot,
      recommendationExploringSelection: Boolean(activeSeed),
      documentMetadataSyncMessage: documentMetadataSync.message,
      documentMetadataSyncResult: documentMetadataSync.lastResult,
      documentMetadataSyncStatus: documentMetadataSync.status,
      recommendationItems: recommendations.recommendationItems,
      recommendationMessage: metadata.blocked ? metadata.message : recommendations.recommendationMessage,
      recommendationPending: metadata.blocked ? metadata.pending : recommendations.recommendationPending,
      recommendationStatus: metadata.blocked ? metadata.pending ? "loading" as const : "error" as const : recommendations.recommendationStatus
    }
  };
}
