import { defaultRecommendationPreferences, saveRecommendationPreferences } from "../app/features/recommendations/recommendationPreferences";
import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { useKnowledgeSyncController } from "../app/controllers/useKnowledgeSyncController";
import { recommendationDocument } from "../app/features/recommendations/recommendationSeed";
import type { Paper } from "../app/features/workspace/workspace.types";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";
import { confirmedLiterature } from "./fixtures/confirmedLiterature";
const { discover, rank } = vi.hoisted(() => ({ discover: vi.fn(), rank: vi.fn() }));
vi.mock("../app/features/recommendations/localRecommendationClient", () => ({ fetchLocalRecommendations: discover }));
vi.mock("../app/features/recommendations/recommendationHybridPipeline", () => ({ rankContextRecommendations: rank }));
vi.mock("../app/features/recommendations/recommendationContext", async (original) => ({ ...await original<typeof import("../app/features/recommendations/recommendationContext")>(),
  buildRecommendationContext: async ({ papers }: { papers: Paper[] }) => ({ documents: papers.map(recommendationDocument), views: papers.map(paper => ({ id: `paper:${paper.id}`, title: paper.title, text: paper.title, kind: "document", private: false, provenance: "metadata", revision: "1" })), warnings: [] }) }));
const paper: Paper = { id: "p", title: "Attention Is All You Need", literature: confirmedLiterature("Attention Is All You Need") };
const item: RecommendationItem = { id: "candidate", title: "Memory Efficient Attention for Language Models", relevanceScore: .9, relevanceBand: "high", reason: "Shared attention methods", source: "crossref", sourceKind: "live", discoveredAt: "2026-10-14", relatedDocumentTitle: paper.title };
beforeEach(() => { localStorage.clear(); saveRecommendationPreferences({ ...defaultRecommendationPreferences, hybridEnabled: true }); discover.mockReset().mockResolvedValue([item]); rank.mockReset().mockImplementation(async ({ items }) => ({ items, warning: "" })); });
afterEach(() => { vi.useRealTimers(); });
test.each([true, false])("REC-001: 20 selection changes cause zero discovery or model calls while the ordinary feed is fresh (direct %s)", async (direct) => {
  vi.useFakeTimers();
  const cloud = vi.fn(async () => [item]);
  const scope = crypto.randomUUID();
  const base = { localMode: direct, localService: direct ? { provider: "crossref" as const, endpoint: "https://api.crossref.org" } : undefined,
    accountSession: { sessionId: scope, email: "test@example.com", name: "Test", membershipTier: "pro" as const, expiresAt: "2027-01-01T00:00:00Z" },
    controlPlaneEndpoint: "https://example.com", documents: [paper], recommendationsEnabled: true, recommendationSortMode: "relevance" as const,
    personalizationEnabled: false, workspaceRevision: 1, workspaceSourceKey: `workspace:${scope}`, recommendationResources: { scope },
    recommendationGeneratorDeps: { fetch: cloud }, recommendationCacheDeps: { get: vi.fn(async () => ({ cacheHit: false, recommendations: [] })),
      put: vi.fn(async () => ({ cachedAt: new Date().toISOString(), ok: true as const })), clear: vi.fn(async () => ({ cleared: true })) } };
  const hook = renderHook(({ selectedPapers }) => useKnowledgeSyncController({ ...base, selectedPapers }), { initialProps: { selectedPapers: [paper] } });
  for (let tick = 0; tick < 3; tick++) await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(hook.result.current.model.recommendationItems).toHaveLength(1);
  expect(rank).toHaveBeenCalledTimes(1);
  const calls = (direct ? discover : cloud).mock.calls.length, rankingCalls = rank.mock.calls.length;
  const visible: string[][] = [];
  for (let index = 0; index < 20; index++) {
    hook.rerender({ selectedPapers: index % 2 ? [paper] : [] });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    visible.push(hook.result.current.model.recommendationItems.map(value => value.id));
  }
  expect((direct ? discover : cloud).mock.calls.length - calls).toBe(0);
  expect(rank.mock.calls.length - rankingCalls).toBe(0);
  expect(visible.every(ids => ids.length === 1 && ids[0] === item.id)).toBe(true);
});
