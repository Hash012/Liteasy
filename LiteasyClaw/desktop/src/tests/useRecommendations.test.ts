import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useRecommendations } from "../app/features/recommendations/useRecommendations";
import type { AccountSession } from "../app/features/account/account.types";
import type { Paper } from "../app/features/workspace/workspace.types";

const accountSession: AccountSession = {
  email: "researcher@liteasy.dev",
  expiresAt: "2026-05-15T09:30:00Z",
  membershipTier: "pro",
  name: "Liteasy Researcher",
  sessionId: "demo-session-1"
};

const selectedPapers: Paper[] = [
  {
    id: "paper-1",
    sourcePath: "fixtures/paper-1.pdf",
    title: "Attention Is All You Need"
  }
];

describe("useRecommendations", () => {
  test("falls back to local-reader semantics when cloud account is unavailable", async () => {
    const { result } = renderHook(() =>
      useRecommendations({
        accountSession: null,
        controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
        recommendationsEnabled: true,
        recommendationSortMode: "relevance",
        selectedPapers,
        workspaceRevision: 0,
        workspaceSourceKey: "local:/tmp/LiteasyLibrary"
      })
    );

    await waitFor(() => {
      expect(result.current.recommendationStatus).toBe("unauthenticated");
    });

    expect(result.current.recommendationMessage).toBe(
      "当前已退化为本地阅读器，云端推荐不可用。联网并登录后，将自动恢复云端能力。"
    );
  });

  test("loads cached recommendations before generating new ones", async () => {
    const cacheGet = vi.fn(async () => ({
      cacheHit: true,
      recommendations: [
        {
          discoveredAt: "2026-05-14T08:15:00Z",
          id: "rec-transformer-1",
          relatedDocumentTitle: "Attention Is All You Need",
          relevanceBand: "high" as const,
          relevanceScore: 0.91,
          reason: "cached",
          source: "Semantic Scholar",
          title: "An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale"
        }
      ]
    }));
    const recommendationFetch = vi.fn(async () => []);
    const cachePut = vi.fn(async () => ({ cachedAt: "2026-05-14T08:15:00Z", ok: true as const }));

    const { result } = renderHook(() =>
      useRecommendations({
        accountSession,
        controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
        recommendationCacheDeps: {
          clear: vi.fn(),
          get: cacheGet,
          put: cachePut
        },
        recommendationGeneratorDeps: {
          fetch: recommendationFetch
        },
        recommendationsEnabled: true,
        recommendationSortMode: "relevance",
        personalizationVersion: 7,
        selectedPapers,
        workspaceRevision: 0,
        workspaceSourceKey: "local:/tmp/LiteasyLibrary"
      })
    );

    await waitFor(() => {
      expect(result.current.recommendationStatus).toBe("ready");
    });

    expect(cacheGet).toHaveBeenCalledTimes(1);
    expect(recommendationFetch).not.toHaveBeenCalled();
    expect(cachePut).not.toHaveBeenCalled();
    expect(cacheGet.mock.calls[0][0].personalizationVersion).toBe(7);
    expect(result.current.recommendationMessage).toBe("已显示当前选中文献集的缓存推荐。");
  });

  test("generates recommendations on cache miss and writes them back to cache", async () => {
    const generatedRecommendations = [
      {
        discoveredAt: "2026-05-14T08:15:00Z",
        id: "rec-transformer-1",
        relatedDocumentTitle: "Attention Is All You Need",
        relevanceBand: "high" as const,
        relevanceScore: 0.91,
        reason: "fresh",
        source: "Semantic Scholar",
        title: "An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale"
      }
    ];
    const cacheGet = vi.fn(async () => ({
      cacheHit: false,
      recommendations: []
    }));
    const recommendationFetch = vi.fn(async () => generatedRecommendations);
    const cachePut = vi.fn(async () => ({ cachedAt: "2026-05-14T08:15:00Z", ok: true as const }));

    const { result } = renderHook(() =>
      useRecommendations({
        accountSession,
        controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
        recommendationCacheDeps: {
          clear: vi.fn(),
          get: cacheGet,
          put: cachePut
        },
        recommendationGeneratorDeps: {
          fetch: recommendationFetch
        },
        recommendationsEnabled: true,
        recommendationSortMode: "relevance",
        selectedPapers,
        workspaceRevision: 0,
        workspaceSourceKey: "local:/tmp/LiteasyLibrary"
      })
    );

    await waitFor(() => {
      expect(result.current.recommendationStatus).toBe("ready");
    });

    expect(recommendationFetch).toHaveBeenCalledTimes(1);
    expect(cachePut).toHaveBeenCalledTimes(1);
    expect(result.current.recommendationItems).toEqual(generatedRecommendations);
    expect(result.current.recommendationMessage).toBe("已获取 1 条关联推荐。");
  });

  test("clears recommendation cache without affecting recommendation status semantics", async () => {
    const cacheClear = vi.fn(async () => ({ cleared: true }));
    const { result } = renderHook(() =>
      useRecommendations({
        accountSession,
        controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
        recommendationCacheDeps: {
          clear: cacheClear,
          get: vi.fn(async () => ({
            cacheHit: true,
            recommendations: []
          })),
          put: vi.fn()
        },
        recommendationGeneratorDeps: {
          fetch: vi.fn()
        },
        recommendationsEnabled: true,
        recommendationSortMode: "relevance",
        selectedPapers,
        workspaceRevision: 0,
        workspaceSourceKey: "local:/tmp/LiteasyLibrary"
      })
    );

    await waitFor(() => {
      expect(result.current.recommendationStatus).toBe("ready");
    });

    await act(async () => {
      await result.current.clearRecommendationCache();
    });

    expect(cacheClear).toHaveBeenCalledTimes(1);
    expect(result.current.recommendationItems).toEqual([]);
    expect(result.current.recommendationMessage).toBe("已清理当前工作区的关联推荐缓存。");
  });

  test("refreshes recommendations by invalidating the current cache scope", async () => {
    const cacheClear = vi.fn(async () => ({ cleared: true }));
    const cacheGet = vi.fn(async () => ({
      cacheHit: false,
      recommendations: []
    }));
    const recommendationFetch = vi.fn(async () => [{
      discoveredAt: "2026-05-14T08:15:00Z",
      id: "rec-refresh-1",
      relatedDocumentTitle: "Attention Is All You Need",
      relevanceBand: "high" as const,
      relevanceScore: 0.96,
      reason: "refreshed",
      source: "Semantic Scholar",
      title: "Fresh Retrieval Result"
    }]);

    const { result } = renderHook(() =>
      useRecommendations({
        accountSession,
        controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
        recommendationCacheDeps: {
          clear: cacheClear,
          get: cacheGet,
          put: vi.fn(async () => ({ cachedAt: "2026-05-14T08:15:00Z", ok: true as const }))
        },
        recommendationGeneratorDeps: { fetch: recommendationFetch },
        recommendationsEnabled: true,
        recommendationSortMode: "relevance",
        selectedPapers,
        workspaceRevision: 0,
        workspaceSourceKey: "local:/tmp/LiteasyLibrary"
      })
    );

    await waitFor(() => {
      expect(recommendationFetch).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await expect(result.current.refreshRecommendations()).resolves.toBe(
        "已开始刷新当前选中文献集的推荐。"
      );
    });

    await waitFor(() => {
      expect(recommendationFetch).toHaveBeenCalledTimes(2);
    });
    expect(cacheClear).toHaveBeenCalledTimes(1);
    expect(result.current.recommendationItems[0]?.title).toBe("Fresh Retrieval Result");
  });
});
