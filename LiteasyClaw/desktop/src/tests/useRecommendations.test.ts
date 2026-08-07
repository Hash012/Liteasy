import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useRecommendations } from "../app/features/recommendations/useRecommendations";
import type { AccountSession } from "../app/features/account/account.types";
import type { Paper } from "../app/features/workspace/workspace.types";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";

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

  test("shows cached recommendations while refreshing them from the network", async () => {
    const cachedRecommendation = {
      discoveredAt: "2026-05-14T08:15:00Z",
      id: "rec-transformer-cached",
      relatedDocumentTitle: "Attention Is All You Need",
      relevanceBand: "high" as const,
      relevanceScore: 0.91,
      reason: "cached",
      source: "Semantic Scholar",
      sourceKind: "cache" as const,
      title: "An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale"
    };
    const liveRecommendation = {
      ...cachedRecommendation,
      id: "rec-transformer-live",
      reason: "fresh",
      sourceKind: "live" as const,
      sourceUrl: "https://openalex.org/W123"
    };
    const cacheGet = vi.fn(async () => ({
      cacheHit: true,
      recommendations: [cachedRecommendation]
    }));
    let resolveRefresh!: (recommendations: typeof liveRecommendation[]) => void;
    const recommendationFetch = vi.fn(() => new Promise<typeof liveRecommendation[]>((resolve) => {
      resolveRefresh = resolve;
    }));
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
      expect(result.current.recommendationItems).toEqual([cachedRecommendation]);
    });

    expect(cacheGet).toHaveBeenCalledTimes(1);
    expect(recommendationFetch).toHaveBeenCalledTimes(1);
    expect(result.current.recommendationPending).toBe(true);
    expect(cacheGet.mock.calls[0][0]).toEqual({
      personalizationVersion: 7,
      selectionKey: expect.stringMatching(/^selection:[a-f0-9]{8}$/),
      sessionId: "demo-session-1",
      sortMode: "relevance",
      workspaceKey: expect.stringMatching(/^workspace:[a-f0-9]{8}$/)
    });
    expect(JSON.stringify(cacheGet.mock.calls[0][0])).not.toContain("/tmp/LiteasyLibrary");
    expect(result.current.recommendationMessage).toBe("已显示缓存推荐，正在联网刷新。");
    resolveRefresh([liveRecommendation]);
    await waitFor(() => {
      expect(result.current.recommendationPending).toBe(false);
    });

    expect(cachePut).toHaveBeenCalledWith(expect.any(Object), [liveRecommendation]);
    expect(result.current.recommendationItems).toEqual([liveRecommendation]);
    expect(result.current.recommendationMessage).toBe("已获取 1 条关联推荐。");
  });

  test("keeps cached recommendations when the network refresh fails", async () => {
    const cachedRecommendation = {
      discoveredAt: "2026-05-14T08:15:00Z",
      id: "rec-transformer-cached",
      relatedDocumentTitle: "Attention Is All You Need",
      relevanceBand: "high" as const,
      relevanceScore: 0.91,
      reason: "cached",
      source: "Semantic Scholar",
      sourceKind: "cache" as const,
      title: "Cached Transformer Paper"
    };
    const { result } = renderHook(() =>
      useRecommendations({
        accountSession,
        controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
        recommendationCacheDeps: {
          clear: vi.fn(),
          get: vi.fn(async () => ({ cacheHit: true, recommendations: [cachedRecommendation] })),
          put: vi.fn()
        },
        recommendationGeneratorDeps: {
          fetch: vi.fn(async () => {
            throw new Error("external_knowledge_unavailable");
          })
        },
        recommendationsEnabled: true,
        recommendationSortMode: "relevance",
        selectedPapers,
        workspaceRevision: 0,
        workspaceSourceKey: "local:/tmp/LiteasyLibrary"
      })
    );

    await waitFor(() => {
      expect(result.current.recommendationPending).toBe(false);
    });

    expect(result.current.recommendationItems).toEqual([cachedRecommendation]);
    expect(result.current.recommendationStatus).toBe("ready");
    expect(result.current.recommendationMessage).toContain("已显示缓存推荐；联网刷新失败");
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
        sourceKind: "mock",
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
        researchProfile: {
          datasets: ["BEIR"],
          languages: ["中文"],
          methods: ["hybrid retrieval"],
          topics: ["neural retrieval"]
        },
        selectedPapers,
        workspaceRevision: 0,
        workspaceSourceKey: "local:/tmp/LiteasyLibrary"
      })
    );

    await waitFor(() => {
      expect(result.current.recommendationStatus).toBe("ready");
    });

    expect(recommendationFetch).toHaveBeenCalledTimes(1);
    expect(recommendationFetch).toHaveBeenCalledWith(expect.objectContaining({
      researchProfile: {
        datasets: ["BEIR"],
        languages: ["中文"],
        methods: ["hybrid retrieval"],
        topics: ["neural retrieval"]
      }
    }));
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
          fetch: vi.fn(async () => [])
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

  test("records a negative preference and removes the dismissed candidate", async () => {
    const candidate = {
      canonicalId: "openalex:W200",
      discoveredAt: "2026-07-29T00:00:00Z",
      id: "reading-candidate:openalex:W200",
      relatedDocumentTitle: "Attention Is All You Need",
      relevanceBand: "high" as const,
      relevanceScore: 0.9,
      reason: "related",
      source: "OpenAlex",
      sourceKind: "live" as const,
      sourceUrl: "https://openalex.org/W200",
      title: "Candidate Transformer Paper"
    };
    const feedbackRecord = vi.fn(async () => ({ action: "dismissed" }));
    const { result } = renderHook(() => useRecommendations({
      accountSession,
      controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
      recommendationCacheDeps: {
        clear: vi.fn(),
        get: vi.fn(async () => ({ cacheHit: true, recommendations: [candidate] })),
        put: vi.fn()
      },
      recommendationGeneratorDeps: {
        fetch: vi.fn(async () => [candidate])
      },
      recommendationFeedbackDeps: { record: feedbackRecord },
      recommendationsEnabled: true,
      recommendationSortMode: "relevance",
      selectedPapers,
      workspaceRevision: 0,
      workspaceSourceKey: "local:/tmp/LiteasyLibrary"
    }));
    await waitFor(() => expect(result.current.recommendationItems).toHaveLength(1));

    await act(async () => {
      await result.current.recordRecommendationFeedback(candidate, "dismissed");
    });

    expect(feedbackRecord).toHaveBeenCalledWith({
      action: "dismissed",
      candidate,
      sessionId: "demo-session-1"
    });
    expect(result.current.recommendationItems).toEqual([]);
    expect(result.current.recommendationMessage).toContain("降低相似候选排序");
  });

  test("a personalizationVersion bump while a fetch is in flight does not drop results or refetch", async () => {
    let resolveFetch: ((items: RecommendationItem[]) => void) | undefined;
    const fetchPromise = new Promise<RecommendationItem[]>((resolve) => {
      resolveFetch = resolve;
    });
    const cacheGet = vi.fn(async () => ({ cacheHit: false as const, recommendations: [] as RecommendationItem[] }));
    const cachePut = vi.fn(async () => ({ cachedAt: "2026-05-14T08:15:00Z", ok: true as const }));
    const recommendationFetch = vi.fn(() => fetchPromise);

    const item: RecommendationItem = {
      discoveredAt: "2026-05-14T08:15:00Z",
      id: "rec-stable-1",
      relatedDocumentTitle: "Attention Is All You Need",
      relevanceBand: "high",
      relevanceScore: 0.8,
      reason: "stable",
      source: "OpenAlex",
      sourceKind: "live",
      title: "Stable Recommendation Across Profile Loads"
    };

    const { result, rerender } = renderHook(
      ({ pv }) => useRecommendations({
        accountSession,
        controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
        recommendationCacheDeps: { clear: vi.fn(), get: cacheGet, put: cachePut },
        recommendationGeneratorDeps: { fetch: recommendationFetch },
        recommendationsEnabled: true,
        recommendationSortMode: "relevance",
        personalizationVersion: pv,
        selectedPapers,
        workspaceRevision: 0,
        workspaceSourceKey: "local:/tmp/LiteasyLibrary"
      }),
      { initialProps: { pv: 0 } }
    );

    await waitFor(() => expect(recommendationFetch).toHaveBeenCalledTimes(1));

    // Simulate the profile loading / a signal bumping personalizationVersion mid-fetch.
    rerender({ pv: 9 });
    await Promise.resolve();

    // The in-flight fetch must NOT have been cancelled and no second fetch started.
    expect(recommendationFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch?.([item]);
      await fetchPromise;
    });

    await waitFor(() => expect(result.current.recommendationItems).toHaveLength(1));
    expect(result.current.recommendationItems[0].id).toBe("rec-stable-1");
    expect(result.current.recommendationStatus).toBe("ready");
  });
});
