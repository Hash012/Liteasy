import { useEffect, useRef, useState } from "react";
import { formatCloudConnectionError } from "../network/cloudErrorMessage";
import type { AccountSession } from "../account/account.types";
import type { SettingsState } from "../settings/settings.types";
import { fetchCloudRecommendations } from "./recommendationRuntime";
import {
  clearCloudRecommendationCache,
  getCloudRecommendationCache,
  putCloudRecommendationCache
} from "./recommendationCacheRuntime";
import type {
  RecommendationItem,
  RecommendationResearchProfile,
  RecommendationStatus
} from "./recommendation.types";
import type { RecommendationTransport } from "./recommendationClient";
import type { Paper } from "../workspace/workspace.types";
import type { RecommendationCacheScope } from "./recommendationCache.types";
import type { RecommendationCacheTransport } from "./recommendationCacheClient";
import {
  createRecommendationFeedbackClient,
  type RecommendationFeedbackAction,
  type RecommendationFeedbackTransport
} from "./recommendationFeedbackClient";

type UseRecommendationsInput = {
  accountSession: AccountSession | null;
  controlPlaneEndpoint: string;
  openAlexApiKey?: string;
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
  recommendationGeneratorDeps?: {
    fetch: (input: {
      controlPlaneEndpoint: string;
      openAlexApiKey?: string;
      researchProfile?: RecommendationResearchProfile;
      selectedDocuments: Array<{ id: string; title: string }>;
      sessionId: string;
      sortMode: SettingsState["network.recommendation.sort_mode"];
    }) => Promise<RecommendationItem[]>;
  };
  recommendationFeedbackDeps?: {
    record: (input: {
      action: RecommendationFeedbackAction;
      candidate: RecommendationItem;
      sessionId: string;
    }) => Promise<unknown>;
  };
  recommendationFeedbackTransport?: RecommendationFeedbackTransport;
  recommendationTransport?: RecommendationTransport;
  recommendationCacheTransport?: RecommendationCacheTransport;
  recommendationsEnabled: boolean;
  recommendationSortMode: SettingsState["network.recommendation.sort_mode"];
  personalizationVersion?: number;
  researchProfile?: RecommendationResearchProfile;
  selectedPapers: Paper[];
  workspaceRevision: number;
  workspaceSourceKey: string;
};

function buildSelectionCacheKey(
  selectedPapers: Paper[],
  researchProfile?: RecommendationResearchProfile
) {
  const paperKey = selectedPapers
    .map((paper) => paper.id)
    .sort()
    .join("|");
  if (!researchProfile) {
    return paperKey;
  }
  const serializedProfile = JSON.stringify(researchProfile);
  let hash = 2166136261;
  for (let index = 0; index < serializedProfile.length; index += 1) {
    hash ^= serializedProfile.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${paperKey}::profile:${(hash >>> 0).toString(16)}`;
}

function sortRecommendationItems(
  items: RecommendationItem[],
  sortMode: SettingsState["network.recommendation.sort_mode"]
) {
  const nextItems = [...items];

  if (sortMode === "retrieved_at") {
    return nextItems.sort((left, right) => right.discoveredAt.localeCompare(left.discoveredAt));
  }

  return nextItems.sort((left, right) => right.relevanceScore - left.relevanceScore);
}

export function useRecommendations({
  accountSession,
  controlPlaneEndpoint,
  openAlexApiKey,
  recommendationCacheDeps,
  recommendationFeedbackDeps,
  recommendationFeedbackTransport,
  recommendationGeneratorDeps,
  recommendationCacheTransport,
  recommendationTransport,
  recommendationsEnabled,
  recommendationSortMode,
  personalizationVersion = 0,
  researchProfile,
  selectedPapers,
  workspaceRevision,
  workspaceSourceKey
}: UseRecommendationsInput) {
  const suppressNextCachedMessageRef = useRef(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const selectionKey = buildSelectionCacheKey(selectedPapers, researchProfile);
  const currentScope = accountSession
    ? {
        selectionKey,
        sessionId: accountSession.sessionId,
        sortMode: recommendationSortMode,
        workspaceKey: workspaceSourceKey,
        personalizationVersion
      }
    : null;
  const [recommendationItems, setRecommendationItems] = useState<RecommendationItem[]>([]);
  const [recommendationMessage, setRecommendationMessage] = useState(
    "勾选文献后，这里会显示与当前选中文献集相关的推荐。"
  );
  const [recommendationPending, setRecommendationPending] = useState(false);
  const [recommendationStatus, setRecommendationStatus] = useState<RecommendationStatus>("idle");

  useEffect(() => {
    setRecommendationItems([]);
    setRecommendationPending(false);
    setRecommendationStatus("idle");
    setRecommendationMessage("勾选文献后，这里会显示与当前选中文献集相关的推荐。");
  }, [workspaceRevision]);

  useEffect(() => {
    if (!recommendationsEnabled) {
      setRecommendationItems([]);
      setRecommendationPending(false);
      setRecommendationStatus("disabled");
      setRecommendationMessage("联网推荐已关闭，可在右栏输入 / 重新开启。");
      return;
    }

    if (selectedPapers.length === 0) {
      setRecommendationItems([]);
      setRecommendationPending(false);
      setRecommendationStatus("idle");
      setRecommendationMessage("勾选文献后，这里会显示与当前选中文献集相关的推荐。");
      return;
    }

    if (!accountSession) {
      setRecommendationItems([]);
      setRecommendationPending(false);
      setRecommendationStatus("unauthenticated");
      setRecommendationMessage("当前已退化为本地阅读器，云端推荐不可用。联网并登录后，将自动恢复云端能力。");
      return;
    }

    let active = true;
    const session = accountSession;
    setRecommendationPending(true);
    setRecommendationStatus("loading");
    setRecommendationMessage("正在获取与当前选中文献集相关的推荐...");

    const cacheApi = recommendationCacheDeps ?? {
      clear: (scope: RecommendationCacheScope) =>
        clearCloudRecommendationCache(
          {
            controlPlaneEndpoint,
            scope
          },
          {
            transport: recommendationCacheTransport
          }
        ),
      get: (scope: RecommendationCacheScope) =>
        getCloudRecommendationCache(
          {
            controlPlaneEndpoint,
            scope
          },
          {
            transport: recommendationCacheTransport
          }
        ),
      put: (scope: RecommendationCacheScope, recommendations: RecommendationItem[]) =>
        putCloudRecommendationCache(
          {
            controlPlaneEndpoint,
            recommendations,
            scope
          },
          {
            transport: recommendationCacheTransport
          }
        )
    };

    const generatorApi = recommendationGeneratorDeps ?? {
      fetch: (input: {
        controlPlaneEndpoint: string;
        openAlexApiKey?: string;
        researchProfile?: RecommendationResearchProfile;
        selectedDocuments: Array<{ id: string; title: string }>;
        sessionId: string;
        sortMode: SettingsState["network.recommendation.sort_mode"];
      }) =>
        fetchCloudRecommendations(input, {
          transport: recommendationTransport
        })
    };

    async function runRecommendationFlow() {
      let cacheResult:
        | {
            cacheHit: boolean;
            recommendations: RecommendationItem[];
          }
        | null = null;

      try {
        cacheResult = await cacheApi.get(currentScope!);
      } catch {
        cacheResult = null;
      }

      if (cacheResult?.cacheHit) {
        return {
          fromCache: true as const,
          recommendations: sortRecommendationItems(
            cacheResult.recommendations,
            recommendationSortMode
          )
        };
      }

      const generatedRecommendations = await generatorApi.fetch({
        controlPlaneEndpoint,
        openAlexApiKey,
        researchProfile,
        sortMode: recommendationSortMode,
        selectedDocuments: selectedPapers.map((paper) => ({
          id: paper.id,
          title: paper.title
        })),
        sessionId: session.sessionId
      });

      try {
        await cacheApi.put(currentScope!, generatedRecommendations);
      } catch {
        // Cache write-back is best-effort. Recommendation display must still succeed.
      }

      return {
        fromCache: false as const,
        recommendations: sortRecommendationItems(
          generatedRecommendations,
          recommendationSortMode
        )
      };
    }

    void runRecommendationFlow()
      .then((items) => {
        if (!active) {
          return;
        }

        setRecommendationItems(items.recommendations);
        setRecommendationStatus("ready");
        if (items.fromCache) {
          if (suppressNextCachedMessageRef.current) {
            suppressNextCachedMessageRef.current = false;
            return;
          }
          setRecommendationMessage("已显示当前选中文献集的缓存推荐。");
          return;
        }

        setRecommendationMessage(
          items.recommendations.length > 0
            ? `已获取 ${items.recommendations.length} 条关联推荐。`
            : "当前没有可展示的关联推荐。"
        );
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        const detail = formatCloudConnectionError(error, {
          controlPlaneEndpoint
        });
        setRecommendationItems([]);
        setRecommendationStatus("error");
        setRecommendationMessage(`关联推荐获取失败。详细信息：${detail}`);
      })
      .finally(() => {
        if (active) {
          setRecommendationPending(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    accountSession?.sessionId,
    controlPlaneEndpoint,
    openAlexApiKey,
    recommendationCacheTransport,
    recommendationTransport,
    recommendationsEnabled,
    recommendationSortMode,
    personalizationVersion,
    refreshVersion,
    selectionKey,
    workspaceSourceKey
  ]);

  async function clearRecommendationCache() {
    if (!currentScope) {
      setRecommendationItems([]);
      setRecommendationPending(false);
      setRecommendationStatus("idle");
      setRecommendationMessage("已清理当前工作区的关联推荐缓存。");
      return;
    }

    const cacheApi = recommendationCacheDeps ?? {
      clear: (scope: RecommendationCacheScope) =>
        clearCloudRecommendationCache(
          {
            controlPlaneEndpoint,
            scope
          },
          {
            transport: recommendationCacheTransport
          }
        )
    };

    await cacheApi.clear(currentScope);
    suppressNextCachedMessageRef.current = true;
    setRecommendationItems([]);
    setRecommendationPending(false);
    setRecommendationStatus("idle");
    setRecommendationMessage("已清理当前工作区的关联推荐缓存。");
  }

  async function refreshRecommendations() {
    if (!recommendationsEnabled) {
      return "联网推荐当前已关闭，请先开启后再刷新。";
    }

    if (!accountSession || !currentScope) {
      return "请先登录云账号后再刷新推荐。";
    }

    if (selectedPapers.length === 0) {
      return "请先选择至少一篇文献后再刷新推荐。";
    }

    const cacheApi = recommendationCacheDeps ?? {
      clear: (scope: RecommendationCacheScope) =>
        clearCloudRecommendationCache(
          {
            controlPlaneEndpoint,
            scope
          },
          {
            transport: recommendationCacheTransport
          }
        )
    };

    try {
      await cacheApi.clear(currentScope);
    } catch {
      return "推荐缓存清理失败，暂时无法刷新推荐。";
    }

    suppressNextCachedMessageRef.current = true;
    setRecommendationItems([]);
    setRecommendationPending(true);
    setRecommendationStatus("loading");
    setRecommendationMessage("正在刷新与当前选中文献集相关的推荐...");
    setRefreshVersion((current) => current + 1);
    return "已开始刷新当前选中文献集的推荐。";
  }

  function dismissRecommendation(recommendationId: string) {
    setRecommendationItems((currentItems) =>
      currentItems.filter((recommendation) => recommendation.id !== recommendationId)
    );
    setRecommendationMessage("已减少类似推荐，后续结果会继续调整。");
  }

  async function recordRecommendationFeedback(
    candidate: RecommendationItem,
    action: RecommendationFeedbackAction
  ) {
    if (!accountSession) {
      setRecommendationMessage("登录后才能保存推荐反馈。");
      return false;
    }
    const feedbackApi = recommendationFeedbackDeps ?? {
      record: createRecommendationFeedbackClient({
        endpoint: controlPlaneEndpoint,
        transport: recommendationFeedbackTransport
      })
    };
    try {
      await feedbackApi.record({
        action,
        candidate,
        sessionId: accountSession.sessionId
      });
    } catch {
      setRecommendationMessage("推荐反馈保存失败，请稍后重试。");
      return false;
    }
    setRecommendationItems((items) => items.filter((item) => item.id !== candidate.id));
    setRecommendationMessage(action === "saved"
      ? "已收藏，并用于改进后续推荐。"
      : "已标记不感兴趣，并用于降低相似候选排序。");
    return true;
  }

  return {
    clearRecommendationCache,
    dismissRecommendation,
    refreshRecommendations,
    recordRecommendationFeedback,
    recommendationItems,
    recommendationMessage,
    recommendationPending,
    recommendationStatus
  };
}
