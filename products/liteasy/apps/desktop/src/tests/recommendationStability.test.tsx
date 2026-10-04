import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useKnowledgeSyncController } from "../app/controllers/useKnowledgeSyncController";
import { useLocalRecommendations } from "../app/features/recommendations/useLocalRecommendations";
import { createPdfReaderPositionStore } from "../app/features/pdf/pdfReaderPosition";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { PAPER_ANNOTATIONS_SAVED_EVENT } from "../app/features/library/userPaperArtifactClient";
import { pdfAnnotationStorageKey } from "../app/features/pdf/pdfAnnotationStorage";
import { recommendationDocument } from "../app/features/recommendations/recommendationSeed";
import { defaultRecommendationPreferences } from "../app/features/recommendations/recommendationPreferences";
import type { RecommendationContext } from "../app/features/recommendations/recommendationContext";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";
import type { Paper } from "../app/features/workspace/workspace.types";
import { confirmedLiterature } from "./fixtures/confirmedLiterature";

const { build, fetchLocal, rank } = vi.hoisted(() => ({ build: vi.fn(), fetchLocal: vi.fn(), rank: vi.fn() }));
vi.mock("../app/features/recommendations/recommendationContext", async (original) => ({
  ...await original<typeof import("../app/features/recommendations/recommendationContext")>(), buildRecommendationContext: build,
}));
vi.mock("../app/features/recommendations/localRecommendationClient", () => ({ fetchLocalRecommendations: fetchLocal }));
vi.mock("../app/features/recommendations/recommendationHybridPipeline", () => ({ rankContextRecommendations: rank }));
const paper: Paper = { id: "p1", title: "Attention Is All You Need", literature: confirmedLiterature("Attention Is All You Need") };
const candidate: RecommendationItem = { id: "r1", title: "Memory Efficient Attention for Language Models", discoveredAt: "2026-10-04", relatedDocumentTitle: paper.title,
  relevanceBand: "high", relevanceScore: .9, reason: "Related methods", source: "Crossref", sourceKind: "live" };
const contextFor = (papers = [paper]): RecommendationContext => ({ documents: papers.map(recommendationDocument), warnings: [], views: [] });
const waitForChanges = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 680)); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto); localStorage.clear();
  build.mockReset().mockImplementation(async ({ papers }: { papers: Paper[] }) => contextFor(papers));
  fetchLocal.mockReset().mockResolvedValue([candidate]);
  rank.mockReset().mockImplementation(async ({ items }: { items: RecommendationItem[] }) => ({ items, warning: "" }));
});
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });
function setup(localMode = true) {
  const scope = crypto.randomUUID();
  const fetchCloud = vi.fn(async () => [candidate]);
  const base = { localMode, localService: localMode ? { provider: "crossref" as const, endpoint: "https://api.crossref.org" } : undefined,
    accountSession: { sessionId: scope, email: "test@example.com", name: "Test", membershipTier: "pro" as const, expiresAt: "2027-01-01T00:00:00Z" },
    controlPlaneEndpoint: "https://example.com", documents: [paper], selectedPapers: [paper], recommendationsEnabled: true,
    recommendationSortMode: "relevance" as const, personalizationEnabled: false, workspaceRevision: 1, workspaceSourceKey: "local_library:/test",
    recommendationResources: { scope }, recommendationGeneratorDeps: { fetch: fetchCloud },
    recommendationCacheDeps: { get: vi.fn(async () => ({ cacheHit: false, recommendations: [] })), put: vi.fn(async () => ({ cachedAt: "now", ok: true as const })), clear: vi.fn(async () => ({ cleared: true })) } };
  return { scope, base, fetchCloud };
}

test.each([true, false])("PDF position writes keep recommendations visible without rebuilding or refetching (local: %s)", async (localMode) => {
  const { scope, base, fetchCloud } = setup(localMode);
  const frames: number[] = [];
  const hook = renderHook(() => { const result = useKnowledgeSyncController(base); frames.push(result.model.recommendationItems.length); return result; });
  await waitFor(() => expect(hook.result.current.model.recommendationItems).toHaveLength(1));
  const items = hook.result.current.model.recommendationItems;
  const start = frames.length;
  const positions = createPdfReaderPositionStore(scope, () => scope);
  for (const page of [2, 3]) {
    await act(async () => positions.save(paper.id, "sha256:book", page));
    await waitForChanges();
  }
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: "liteasy.paper-reading.history.v1:local", newValue: "page4" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "liteasy.local-recommendations.v1:cache", newValue: "updated" }));
    window.dispatchEvent(new CustomEvent(PAPER_ANNOTATIONS_SAVED_EVENT, { detail: "another-paper" }));
  });
  await waitForChanges();
  expect(build).toHaveBeenCalledTimes(1);
  expect(localMode ? fetchLocal : fetchCloud).toHaveBeenCalledTimes(1);
  expect(hook.result.current.model.recommendationItems).toBe(items);
  expect(frames.slice(start).every((count) => count === 1)).toBe(true);
  expect(await positions.load(paper.id, "sha256:book")).toBe(3);
});

test("related note edits rebuild in the background and replace recommendations without an empty frame", async () => {
  const { scope, base } = setup();
  const frames: string[][] = [];
  const hook = renderHook(() => { const result = useKnowledgeSyncController(base); frames.push(result.model.recommendationItems.map((item) => item.id)); return result; });
  await waitFor(() => expect(hook.result.current.model.recommendationItems).toHaveLength(1));
  const start = frames.length, nextContext = deferred<RecommendationContext>(), nextResults = deferred<RecommendationItem[]>();
  build.mockReturnValueOnce(nextContext.promise); fetchLocal.mockReturnValueOnce(nextResults.promise);
  const storage = createObjectStorage(scope, () => scope);
  await act(async () => storage.commit([{ key: "head/linked-note", expected: null, row: { key: "head/linked-note", version: "2", value: {} } }]));
  await waitFor(() => expect(build).toHaveBeenCalledTimes(2));
  expect(hook.result.current.model.recommendationItems.map((item) => item.id)).toEqual(["r1"]);
  await act(async () => nextContext.resolve({ ...contextFor(), views: [{ id: "annotation:new", title: "A new research question", text: "How is attention memory reduced?", kind: "annotation", provenance: "user-note", revision: "2", private: true }] }));
  await waitFor(() => expect(fetchLocal).toHaveBeenCalledTimes(2));
  expect(hook.result.current.model.recommendationItems.map((item) => item.id)).toEqual(["r1"]);
  await act(async () => nextResults.resolve([{ ...candidate, id: "r2" }]));
  await waitFor(() => expect(hook.result.current.model.recommendationItems.map((item) => item.id)).toEqual(["r2"]));
  expect(frames.slice(start).every((items) => items.length > 0)).toBe(true);
});

test("current annotations still update context and switching scope drops a pending old result", async () => {
  const { base } = setup();
  const hook = renderHook(({ scope }) => useKnowledgeSyncController({ ...base, recommendationResources: { scope } }), { initialProps: { scope: base.recommendationResources.scope } });
  await waitFor(() => expect(hook.result.current.model.recommendationItems).toHaveLength(1));
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: pdfAnnotationStorageKey(paper), newValue: "changed" })));
  await waitFor(() => expect(build).toHaveBeenCalledTimes(2));
  const oldContext = deferred<RecommendationContext>(); build.mockReturnValueOnce(oldContext.promise);
  act(() => window.dispatchEvent(new CustomEvent(PAPER_ANNOTATIONS_SAVED_EVENT, { detail: paper.id })));
  await waitFor(() => expect(build).toHaveBeenCalledTimes(3));
  const newContext = deferred<RecommendationContext>(); build.mockReturnValueOnce(newContext.promise);
  hook.rerender({ scope: crypto.randomUUID() });
  expect(hook.result.current.model.recommendationItems).toEqual([]);
  await act(async () => oldContext.resolve({ ...contextFor(), documents: [{ id: "old-private", title: "Previous scope private note" }] }));
  expect(hook.result.current.model.recommendationItems).toEqual([]);
});

test("local refresh keeps current items when the cache is missing, but a new selection or disabling clears them", async () => {
  const original = { enabled: true, config: { provider: "crossref" as const, endpoint: "https://api.crossref.org" }, papers: [paper], context: contextFor(),
    preferences: defaultRecommendationPreferences, scopeId: "local", workspace: "/test", style: "balanced" as const, sort: "relevance" as const };
  const hook = renderHook(({ enabled, papers, context }) => useLocalRecommendations({ ...original, enabled, papers, context }), { initialProps: original });
  await waitFor(() => expect(hook.result.current.recommendationItems).toHaveLength(1));
  localStorage.clear();
  const next = deferred<RecommendationItem[]>(); fetchLocal.mockReturnValueOnce(next.promise);
  act(() => hook.result.current.refreshRecommendations());
  await waitFor(() => expect(fetchLocal).toHaveBeenCalledTimes(2));
  expect(hook.result.current.recommendationItems).toHaveLength(1);
  await act(async () => next.resolve([]));
  await waitFor(() => expect(hook.result.current.recommendationPending).toBe(false));
  expect(hook.result.current.recommendationItems).toEqual([]); // A completed empty response is a real replacement.
  act(() => hook.result.current.refreshRecommendations());
  await waitFor(() => expect(hook.result.current.recommendationItems).toHaveLength(1));
  const other = { ...paper, id: "other", title: "Other paper" };
  hook.rerender({ ...original, papers: [other], context: contextFor([other]) });
  expect(hook.result.current.recommendationItems).toEqual([]);
  await waitFor(() => expect(hook.result.current.recommendationItems).toHaveLength(1));
  hook.rerender({ ...original, enabled: false });
  expect(hook.result.current.recommendationItems).toEqual([]);
});
