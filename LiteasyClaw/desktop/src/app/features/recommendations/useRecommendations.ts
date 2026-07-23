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
  RecommendationStatus
} from "./recommendation.types";
import type { RecommendationTransport } from "./recommendationClient";
import type { Paper } from "../workspace/workspace.types";
import type { RecommendationCacheScope } from "./recommendationCache.types";
import type { RecommendationCacheTransport } from "./recommendationCacheClient";

type UseRecommendationsInput = {
  accountSession: AccountSession | null;
  controlPlaneEndpoint: string;
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
      selectedDocuments: Array<{ id: string; title: string }>;
      sessionId: string;
      sortMode: SettingsState["network.recommendation.sort_mode"];
    }) => Promise<RecommendationItem[]>;
  };
  recommendationTransport?: RecommendationTransport;
  recommendationCacheTransport?: RecommendationCacheTransport;
  recommendationsEnabled: boolean;
  recommendationSortMode: SettingsState["network.recommendation.sort_mode"];
  personalizationVersion?: number;
  selectedPapers: Paper[];
  workspaceRevision: number;
  workspaceSourceKey: string;
};

function buildSelectionCacheKey(selectedPapers: Paper[]) {
  return selectedPapers
    .map((paper) => paper.id)
    .sort()
    .join("|");
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
  recommendationCacheDeps,
  recommendationGeneratorDeps,
  recommendationCacheTransport,
  recommendationTransport,
  recommendationsEnabled,
  recommendationSortMode,
  personalizationVersion = 0,
  selectedPapers,
  workspaceRevision,
  workspaceSourceKey
}: UseRecommendationsInput) {
  const suppressNextCachedMessageRef = useRef(false);
  const selectionKey = buildSelectionCacheKey(selectedPapers);
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
    recommendationCacheTransport,
    recommendationTransport,
    recommendationsEnabled,
    recommendationSortMode,
    personalizationVersion,
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

  function dismissRecommendation(recommendationId: string) {
    setRecommendationItems((currentItems) =>
      currentItems.filter((recommendation) => recommendation.id !== recommendationId)
    );
    setRecommendationMessage("已减少类似推荐，后续结果会继续调整。");
  }

  return {
    clearRecommendationCache,
    dismissRecommendation,
    recommendationItems,
    recommendationMessage,
    recommendationPending,
    recommendationStatus
  };
}
