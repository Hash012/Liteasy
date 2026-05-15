import { useEffect, useRef, useState } from "react";
import { formatCloudConnectionError } from "../network/cloudErrorMessage";
import type { AccountSession } from "../account/account.types";
import type { SettingsState } from "../settings/settings.types";
import { fetchCloudRecommendations } from "./recommendationRuntime";
import type {
  RecommendationItem,
  RecommendationStatus
} from "./recommendation.types";
import type { RecommendationTransport } from "./recommendationClient";
import type { Paper } from "../workspace/workspace.types";

type UseRecommendationsInput = {
  accountSession: AccountSession | null;
  controlPlaneEndpoint: string;
  recommendationTransport?: RecommendationTransport;
  recommendationsEnabled: boolean;
  recommendationSortMode: SettingsState["network.recommendation.sort_mode"];
  selectedPapers: Paper[];
  workspaceRevision: number;
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
  recommendationTransport,
  recommendationsEnabled,
  recommendationSortMode,
  selectedPapers,
  workspaceRevision
}: UseRecommendationsInput) {
  const cacheRef = useRef(new Map<string, RecommendationItem[]>());
  const selectionCacheKey = buildSelectionCacheKey(selectedPapers);
  const [recommendationItems, setRecommendationItems] = useState<RecommendationItem[]>([]);
  const [recommendationMessage, setRecommendationMessage] = useState(
    "勾选文献后，这里会显示与当前选中文献集相关的推荐。"
  );
  const [recommendationPending, setRecommendationPending] = useState(false);
  const [recommendationStatus, setRecommendationStatus] = useState<RecommendationStatus>("idle");

  useEffect(() => {
    cacheRef.current.clear();
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
      setRecommendationMessage("联网推荐已关闭，可在右栏命令模式重新开启。");
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
      setRecommendationMessage("连接开发云账号后，可查看与当前选中文献集相关的推荐。");
      return;
    }

    const cachedItems = cacheRef.current.get(selectionCacheKey);
    if (cachedItems) {
      setRecommendationItems(sortRecommendationItems(cachedItems, recommendationSortMode));
      setRecommendationPending(false);
      setRecommendationStatus("ready");
      setRecommendationMessage("已显示当前选中文献集的缓存推荐。");
      return;
    }

    let active = true;
    setRecommendationPending(true);
    setRecommendationStatus("loading");
    setRecommendationMessage("正在获取与当前选中文献集相关的推荐...");

    void fetchCloudRecommendations(
      {
        controlPlaneEndpoint,
        sortMode: recommendationSortMode,
        selectedDocuments: selectedPapers.map((paper) => ({
          id: paper.id,
          title: paper.title
        })),
        sessionId: accountSession.sessionId
      },
      {
        transport: recommendationTransport
      }
    )
      .then((items) => {
        if (!active) {
          return;
        }

        cacheRef.current.set(selectionCacheKey, items);
        setRecommendationItems(sortRecommendationItems(items, recommendationSortMode));
        setRecommendationStatus("ready");
        setRecommendationMessage(
          items.length > 0 ? `已获取 ${items.length} 条关联推荐。` : "当前没有可展示的关联推荐。"
        );
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        const detail = formatCloudConnectionError(error);
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
    recommendationTransport,
    recommendationsEnabled,
    recommendationSortMode,
    selectionCacheKey
  ]);

  function clearRecommendationCache() {
    cacheRef.current.clear();
    setRecommendationItems([]);
    setRecommendationPending(false);
    setRecommendationStatus("idle");
    setRecommendationMessage("已清理当前工作区的关联推荐缓存。");
  }

  return {
    clearRecommendationCache,
    recommendationItems,
    recommendationMessage,
    recommendationPending,
    recommendationStatus
  };
}
