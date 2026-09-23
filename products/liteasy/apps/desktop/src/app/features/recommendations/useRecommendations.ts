import { useEffect, useRef, useState } from "react";
import { formatCloudConnectionError } from "../network/cloudErrorMessage";
import type { AccountSession } from "../account/account.types";
import type { SettingsState } from "../settings/settings.types";
import { fetchCloudRecommendations, type RecommendationRuntimeInput } from "./recommendationRuntime";
import { rankRecommendations, recommendationRankingVersion } from "./recommendationRanking";
import {
  clearCloudRecommendationCache,
  getCloudRecommendationCache,
  putCloudRecommendationCache
} from "./recommendationCacheRuntime";
import type {
  RecommendationItem,
  RecommendationStyle,
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
    fetch: (input: RecommendationRuntimeInput) => Promise<RecommendationItem[]>;
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
  recommendationStyle?: RecommendationStyle;
  personalizationVersion?: number;
  researchProfile?: RecommendationResearchProfile;
  selectedPapers: Paper[];
  workspaceRevision: number;
  workspaceSourceKey: string;
};

function buildSelectionCacheKey(
  selectedPapers: Paper[],
  researchProfile?: RecommendationResearchProfile,
  style: RecommendationStyle = "balanced"
) {
  const paperKey = selectedPapers
    .map((paper) => `${paper.id}:${paper.title}`)
    .sort()
    .join("|");
  const serializedProfile = researchProfile ? JSON.stringify(researchProfile) : "";
  const rawKey = `${recommendationRankingVersion}:${style}:${paperKey}::${serializedProfile}`;
  let hash = 2166136261;
  for (let index = 0; index < rawKey.length; index += 1) {
    hash ^= rawKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `selection:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function buildWorkspaceCacheKey(workspaceSourceKey: string) {
  let hash = 2166136261;
  for (let index = 0; index < workspaceSourceKey.length; index += 1) {
    hash ^= workspaceSourceKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `workspace:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function useRecommendations({
  accountSession,
  controlPlaneEndpoint,
  recommendationCacheDeps,
  recommendationFeedbackDeps,
  recommendationFeedbackTransport,
  recommendationGeneratorDeps,
  recommendationCacheTransport,
  recommendationTransport,
  recommendationsEnabled,
  recommendationSortMode,
  recommendationStyle = "balanced",
  personalizationVersion = 0,
  researchProfile,
  selectedPapers,
  workspaceRevision,
  workspaceSourceKey
}: UseRecommendationsInput) {
  const suppressNextCachedMessageRef = useRef(false);
  const selectionKey = buildSelectionCacheKey(selectedPapers, researchProfile, recommendationStyle);
  const requestController = useRef<AbortController>();
  const cacheWrites = useRef(new Set<{ key: string; promise: Promise<unknown> }>());
  const [refreshVersion, setRefreshVersion] = useState(0);
  const accountKey = `${controlPlaneEndpoint}:${accountSession?.sessionId}`;
  const hidden = useRef({ account: accountKey, ids: new Set<string>() });
  if (hidden.current.account !== accountKey) hidden.current = { account: accountKey, ids: new Set() };
  const scopeKey = `${controlPlaneEndpoint}:${accountSession?.sessionId}:${selectionKey}:${workspaceSourceKey}:${workspaceRevision}:${recommendationSortMode}`;
  const scopeRef = useRef(scopeKey);
  const displayedScope = useRef("");
  scopeRef.current = scopeKey;
  const sortItems = (items: RecommendationItem[]) => rankRecommendations(items.filter((item) => !hidden.current.ids.has(item.canonicalId ?? item.id)), { style: recommendationStyle, sortMode: recommendationSortMode, selectedDocuments: selectedPapers });
  const currentScope = accountSession
      ? {
        personalizationVersion,
        selectionKey,
        sessionId: accountSession.sessionId,
        sortMode: recommendationSortMode,
        workspaceKey: buildWorkspaceCacheKey(workspaceSourceKey)
      }
    : null;
  const cacheKey = JSON.stringify([controlPlaneEndpoint, currentScope]);
  const [recommendationItems, setRecommendationItems] = useState<RecommendationItem[]>([]);
  const [recommendationMessage, setRecommendationMessage] = useState(
    "勾选文献或完善研究兴趣后，这里会显示相关论文推荐。"
  );
  const [recommendationPending, setRecommendationPending] = useState(false);
  const [recommendationStatus, setRecommendationStatus] = useState<RecommendationStatus>("idle");

  useEffect(() => {
    setRecommendationItems([]);
    setRecommendationPending(false);
    setRecommendationStatus("idle");
    setRecommendationMessage("勾选文献或完善研究兴趣后，这里会显示相关论文推荐。");
  }, [workspaceRevision]);

  useEffect(() => {
    if (!recommendationsEnabled) {
      setRecommendationItems([]);
      setRecommendationPending(false);
      setRecommendationStatus("disabled");
      setRecommendationMessage("联网推荐已关闭，可在右栏输入 / 重新开启。");
      return;
    }

    if (selectedPapers.length === 0 && ![...(researchProfile?.topics ?? []), ...(researchProfile?.methods ?? [])].some((term) => term.trim())) {
      setRecommendationItems([]);
      setRecommendationPending(false);
      setRecommendationStatus("idle");
      setRecommendationMessage("勾选文献或完善研究兴趣后，这里会显示相关论文推荐。");
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
    const controller = new AbortController();
    requestController.current = controller;
    const isActive = () => active && !controller.signal.aborted;
    if (displayedScope.current !== scopeKey) setRecommendationItems([]);
    displayedScope.current = scopeKey;
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
      fetch: (input: RecommendationRuntimeInput) =>
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

      if (!isActive()) throw new DOMException("Request superseded", "AbortError");
      if (cacheResult?.cacheHit) {
        if (isActive()) {
          setRecommendationItems(sortItems(cacheResult.recommendations));
          setRecommendationStatus("ready");
          setRecommendationMessage("已显示缓存推荐，正在联网刷新。");
        }
      }

      let generatedRecommendations: RecommendationItem[];
      try {
        generatedRecommendations = await generatorApi.fetch({
          style: recommendationStyle,
          signal: controller.signal,
          controlPlaneEndpoint,
          researchProfile,
          sortMode: recommendationSortMode,
          selectedDocuments: selectedPapers.map((paper) => ({
            id: paper.id,
            title: paper.title
          })),
          sessionId: session.sessionId
        });
      } catch (error) {
        if (cacheResult?.cacheHit) {
          return {
            fromCache: true as const,
            refreshError: error,
            recommendations: sortItems(cacheResult.recommendations)
          };
        }
        throw error;
      }

      if (!isActive()) throw new DOMException("Request superseded", "AbortError");
      try {
        const write = { key: cacheKey, promise: cacheApi.put(currentScope!, generatedRecommendations) };
        cacheWrites.current.add(write);
        try { await write.promise; }
        finally { cacheWrites.current.delete(write); }
      } catch {
        // Cache write-back is best-effort. Recommendation display must still succeed.
      }

      return {
        fromCache: false as const,
        recommendations: sortItems(generatedRecommendations)
      };
    }

    void runRecommendationFlow()
      .then((items) => {
        if (!isActive()) {
          return;
        }

        setRecommendationItems(items.recommendations);
        setRecommendationStatus("ready");
        if (items.fromCache) {
          if (suppressNextCachedMessageRef.current) {
            suppressNextCachedMessageRef.current = false;
            return;
          }
          const detail = formatCloudConnectionError(items.refreshError, {
            controlPlaneEndpoint
          });
          setRecommendationMessage(`已显示缓存推荐；联网刷新失败。详细信息：${detail}`);
          return;
        }

        setRecommendationMessage(
          items.recommendations.length > 0
            ? `已获取 ${items.recommendations.length} 条关联推荐。`
            : "当前没有可展示的关联推荐。"
        );
      })
      .catch((error) => {
        if (!isActive()) {
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
        if (isActive()) {
          setRecommendationPending(false);
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    accountSession?.sessionId,
    controlPlaneEndpoint,
    recommendationCacheTransport,
    recommendationTransport,
    recommendationsEnabled,
    recommendationSortMode,
    recommendationStyle,
    workspaceRevision,
    refreshVersion,
    selectionKey,
    workspaceSourceKey
  ]);

  async function clearRecommendationCache() {
    requestController.current?.abort();
    const startedScope = scopeKey;
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

    try {
      // An already dispatched cache write cannot be aborted. Clear after it
      // settles so an older request cannot repopulate a successfully cleared scope.
      await Promise.allSettled([...cacheWrites.current].filter((write) => write.key === cacheKey).map((write) => write.promise));
      await cacheApi.clear(currentScope);
    }
    catch {
      if (scopeRef.current === startedScope) {
        setRecommendationPending(false);
        setRecommendationStatus("error");
        setRecommendationMessage("推荐缓存清理失败，可重试或刷新推荐。");
      }
      return;
    }
    if (scopeRef.current !== startedScope) return;
    suppressNextCachedMessageRef.current = true;
    setRecommendationItems([]);
    setRecommendationPending(false);
    setRecommendationStatus("idle");
    setRecommendationMessage("已清理当前工作区的关联推荐缓存。");
  }

  async function recordRecommendationFeedback(
    candidate: RecommendationItem,
    action: RecommendationFeedbackAction
  ) {
    if (!accountSession) {
      setRecommendationMessage("登录后才能保存推荐反馈。");
      return false;
    }
    const startedScope = scopeKey;
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
      if (scopeRef.current === startedScope) {
        setRecommendationStatus("error");
        setRecommendationMessage("推荐反馈保存失败，请稍后重试。");
      }
      return false;
    }
    if (hidden.current.account !== accountKey) return false;
    hidden.current.ids.add(candidate.canonicalId ?? candidate.id);
    setRecommendationItems((items) => items.filter((item) => (item.canonicalId ?? item.id) !== (candidate.canonicalId ?? candidate.id)));
    if (scopeRef.current !== startedScope) return true;
    requestController.current?.abort();
    setRecommendationPending(false);
    setRecommendationStatus("ready");
    setRecommendationMessage(action === "saved"
      ? "已收藏，并用于改进后续推荐。"
      : "已标记不感兴趣，并用于降低相似候选排序。");
    return true;
  }

  return {
    clearRecommendationCache,
    refreshRecommendations: () => { requestController.current?.abort(); setRefreshVersion((value) => value + 1); },
    recordRecommendationFeedback,
    recommendationItems,
    recommendationMessage,
    recommendationPending,
    recommendationStatus
  };
}
