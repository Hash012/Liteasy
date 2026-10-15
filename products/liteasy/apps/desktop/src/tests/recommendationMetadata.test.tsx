import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useKnowledgeSyncController } from "../app/controllers/useKnowledgeSyncController";
import { confirmedLiterature } from "./fixtures/confirmedLiterature";
import type { Paper } from "../app/features/workspace/workspace.types";

const paper: Paper = { id: "paper", title: "Cicada", sourcePath: "/papers/Cicada.pdf" };
const title = "Cicada: A Framework for Memory Efficient Language Models";
const confirmed: Paper = { ...paper, literature: confirmedLiterature(title) };
const input = { localMode: true, localService: { provider: "crossref" as const, endpoint: "https://api.crossref.org" },
  accountSession: null, controlPlaneEndpoint: "", documents: [paper], recommendationsEnabled: true,
  recommendationSortMode: "relevance" as const, personalizationEnabled: false,
  recommendationResources: { scope: "local" },
  selectedPapers: [paper], workspaceRevision: 1, workspaceSourceKey: "local_library:/papers" };
beforeEach(() => { input.recommendationResources.scope = crypto.randomUUID(); });
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
function fetchMock() {
  const request = vi.fn(async () => Response.json({ message: { items: [] } }));
  vi.stubGlobal("fetch", request); return request;
}

test("explicit selection exploration waits for identity and uses the confirmed title rather than the filename or stale cache", async () => {
  const request = fetchMock();
  let finish!: (paper: Paper) => void;
  const prepare = vi.fn(() => new Promise<Paper>((resolve) => { finish = resolve; }));
  const hook = renderHook(() => useKnowledgeSyncController({ ...input, prepareRecommendationPaper: prepare }));
  act(() => hook.result.current.actions.exploreSelectedPapers());
  await waitFor(() => expect(prepare).toHaveBeenCalledOnce());
  expect(hook.result.current.model.recommendationPending).toBe(true);
  expect(hook.result.current.model.recommendationMessage).toContain("元数据");
  expect(request).not.toHaveBeenCalled();
  await act(async () => finish(confirmed));
  await waitFor(() => expect(request).toHaveBeenCalledOnce(), { timeout: 3000 });
  expect((request.mock.calls[0][0] as unknown as URL).searchParams.get("query.bibliographic")).toBe(title);
});

test("keeps recommendations blocked after ambiguous metadata and retries on explicit refresh", async () => {
  const request = fetchMock();
  const prepare = vi.fn().mockResolvedValueOnce(paper).mockResolvedValueOnce(confirmed);
  const hook = renderHook(() => useKnowledgeSyncController({ ...input, prepareRecommendationPaper: prepare }));
  act(() => hook.result.current.actions.exploreSelectedPapers());
  await waitFor(() => expect(hook.result.current.model.recommendationStatus).toBe("error"), { timeout: 2000 });
  expect(request).not.toHaveBeenCalled();
  expect(hook.result.current.model.recommendationItems).toEqual([]);
  act(() => hook.result.current.actions.refreshRecommendations());
  await waitFor(() => expect(request).toHaveBeenCalledOnce(), { timeout: 3000 });
  expect(prepare).toHaveBeenCalledTimes(2);
});

test("explicit seed metadata cannot publish into a different workspace", async () => {
  const request = fetchMock();
  let finish!: (paper: Paper) => void;
  const prepare = vi.fn(() => new Promise<Paper>((resolve) => { finish = resolve; }));
  const hook = renderHook(({ selectedPapers, workspaceSourceKey }) => useKnowledgeSyncController({ ...input,
    selectedPapers, workspaceSourceKey, prepareRecommendationPaper: prepare }),
    { initialProps: { selectedPapers: [paper], workspaceSourceKey: input.workspaceSourceKey } });
  act(() => hook.result.current.actions.exploreSelectedPapers());
  await waitFor(() => expect(prepare).toHaveBeenCalledOnce());
  hook.rerender({ selectedPapers: [], workspaceSourceKey: "local_library:/other" });
  await act(async () => finish(confirmed));
  expect(request).not.toHaveBeenCalled();
  expect(hook.result.current.model.recommendationItems).toEqual([]);
  await waitFor(() => expect(hook.result.current.model.recommendationPending).toBe(false));
});

test("skips retrieval for confirmed records and never sends an unconfirmed selection to cloud", async () => {
  const request = fetchMock();
  const prepare = vi.fn();
  const hook = renderHook(() => useKnowledgeSyncController({ ...input, selectedPapers: [confirmed], prepareRecommendationPaper: prepare }));
  act(() => hook.result.current.actions.exploreSelectedPapers());
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  expect(prepare).not.toHaveBeenCalled();
  hook.unmount();
  const cloud = vi.fn();
  const cloudHook = renderHook(() => useKnowledgeSyncController({ ...input, localMode: false, localService: undefined,
    recommendationGeneratorDeps: { fetch: cloud }, selectedPapers: [paper] }));
  act(() => cloudHook.result.current.actions.exploreSelectedPapers());
  await waitFor(() => expect(cloudHook.result.current.model.recommendationStatus).toBe("error"));
  expect(cloud).not.toHaveBeenCalled();
});

test("re-enriches old confirmed short titles before requesting recommendations", async () => {
  const request = fetchMock();
  const insufficient = { ...paper, literature: confirmedLiterature("Cicada") };
  const enriched = { ...paper, literature: { ...insufficient.literature, subjects: ["Database concurrency"],
    abstract: "Timestamp ordering and multicore transactions enable serializable database execution." } };
  const prepare = vi.fn().mockResolvedValue(enriched);
  const hook = renderHook(() => useKnowledgeSyncController({ ...input, selectedPapers: [insufficient], prepareRecommendationPaper: prepare }));
  act(() => hook.result.current.actions.exploreSelectedPapers());
  await waitFor(() => expect(request).toHaveBeenCalledOnce(), { timeout: 3000 });
  expect(prepare).toHaveBeenCalledWith(insufficient);
  expect((request.mock.calls[0][0] as unknown as URL).searchParams.get("query.bibliographic")).toContain("database");
});

test("does not run a stale filename interest query beside a selected paper's verified metadata", async () => {
  const request = fetchMock();
  const enriched = { ...paper, literature: { ...confirmedLiterature("Cicada"), subjects: ["Database concurrency"] } };
  const hook = renderHook(() => useKnowledgeSyncController({ ...input, selectedPapers: [enriched], personalizationEnabled: true,
    researchProfile: { topics: ["Cicada"], methods: [], datasets: [], languages: [] } }));
  act(() => hook.result.current.actions.exploreSelectedPapers());
  await waitFor(() => expect(hook.result.current.model.recommendationPending).toBe(false));
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  expect((request.mock.calls[0][0] as unknown as URL).searchParams.get("query.bibliographic")).toContain("database");
});

test("public paper discovery works without a Liteasy account or a local-service override", async () => {
  const request = fetchMock();
  const hook = renderHook(() => useKnowledgeSyncController({ ...input, localMode: false, localService: undefined,
    documents: [confirmed], selectedPapers: [confirmed] }));
  await waitFor(() => expect(hook.result.current.model.recommendationStatus).toBe("ready"), { timeout: 3000 });
  expect(request).toHaveBeenCalledOnce();
  const url = new URL(String(request.mock.calls[0][0]));
  expect(url.origin).toBe("https://api.crossref.org");
  expect(url.searchParams.get("query.bibliographic")).toBe(title);
});
