import { confirmedLiterature } from "./fixtures/confirmedLiterature";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useKnowledgeSyncController } from "../app/controllers/useKnowledgeSyncController";
import { useProfileActions } from "../app/features/profile/useProfileActions";
import { clearLocalResearchProfile, loadLocalResearchProfile, localProfileTags, recordLocalResearchSignal } from "../app/features/profile/localResearchProfile";
import { fetchLocalRecommendations } from "../app/features/recommendations/localRecommendationClient";
import { paperServiceRequest } from "../app/features/paper-services/paperServiceTransport";
import { createSettingsStore } from "../app/features/settings/settings.store";
vi.mock("../app/features/paper-services/paperServiceTransport", () => ({ paperServiceRequest: vi.fn() }));
const api = vi.mocked(paperServiceRequest);
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); api.mockReset(); });
const paper = { id: "paper-a", title: "Graph neural networks", literature: confirmedLiterature("Graph neural networks") };
const params = { accountSession: null, controlPlaneEndpoint: "https://liteasy.invalid", documents: [paper], selectedPapers: [paper],
  recommendationsEnabled: true, recommendationSortMode: "relevance" as const, recommendationStyle: "balanced" as const,
  personalizationEnabled: true, workspaceRevision: 0, workspaceSourceKey: "local_library:/papers", localMode: true,
  localService: { provider: "crossref" as const, endpoint: "https://api.crossref.org" } };
function result() { return new Response(JSON.stringify({ message: { items: [{ DOI: "10.1234/gnn", title: ["Graph neural network advances"], published: { "date-parts": [[2026]] }, "is-referenced-by-count": 42, author: [{ given: "A", family: "Researcher" }] }] } }), { status: 200 }); }

test("local mode bypasses cloud authentication and metadata upload, caches results offline and persists feedback", async () => {
  api.mockImplementation(async () => result());
  const cloud = vi.fn();
  const { result: hook, unmount } = renderHook(() => useKnowledgeSyncController({ ...params, documentMetadataTransport: cloud, recommendationTransport: cloud }));
  await waitFor(() => expect(hook.current.model.recommendationItems).toHaveLength(1), { timeout: 3000 });
  expect(cloud).not.toHaveBeenCalled();
  expect(api.mock.calls[0][1]).toContain("query.bibliographic=Graph+neural+networks");
  expect(hook.current.model.recommendationItems[0]).toMatchObject({ citationCount: 42, canonicalId: "doi:10.1234/gnn" });
  unmount();
  api.mockClear(); vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const offline = renderHook(() => useKnowledgeSyncController(params));
  await waitFor(() => expect(offline.result.current.model.recommendationPending).toBe(false), { timeout: 3000 });
  expect(offline.result.current.model.recommendationItems).toHaveLength(1);
  expect(offline.result.current.model.recommendationMessage).toContain("显示本机缓存");
  expect(api).not.toHaveBeenCalled();
  await act(async () => { await offline.result.current.actions.dismissRecommendation(offline.result.current.model.recommendationItems[0]); });
  expect(offline.result.current.model.recommendationItems).toHaveLength(0);
  await act(async () => { await offline.result.current.actions.clearRecommendationCache(); });
  expect(localStorage.getItem("liteasy.local-recommendations.v1:guest:local_library:/papers")).toBeNull();
});

test("local learning is opt-in, deduplicates daily reads and remains available after reopening", async () => {
  const transport = vi.fn();
  const hook = renderHook(({ enabled }) => useProfileActions({ localMode: true, profileSamplingEnabled: enabled, transport }), { initialProps: { enabled: false } });
  await act(async () => { await hook.result.current.recordPersonalizationSignal({ kind: "paper_opened", title: paper.title }); });
  expect(loadLocalResearchProfile().events).toHaveLength(0);
  hook.rerender({ enabled: true });
  await act(async () => {
    await hook.result.current.recordPersonalizationSignal({ kind: "paper_opened", title: paper.title });
    await hook.result.current.recordPersonalizationSignal({ kind: "paper_opened", title: paper.title });
    await hook.result.current.recordPersonalizationSignal({ kind: "recommendation_saved", title: "Graph neural applications" });
  });
  expect(loadLocalResearchProfile().events).toHaveLength(2);
  expect(hook.result.current.profileTags.find((tag) => tag.label === "graph")?.evidenceCount).toBe(2);
  hook.unmount();
  const reopened = renderHook(() => useProfileActions({ localMode: true, profileSamplingEnabled: true, transport }));
  expect(reopened.result.current.profileTags.length).toBeGreaterThan(0);
  expect(transport).not.toHaveBeenCalled();
  act(() => clearLocalResearchProfile());
  expect(reopened.result.current.profileTags).toEqual([]);
});

test("local settings persist without enabling cloud profiling and recorded events stay bounded", () => {
  const settings = createSettingsStore();
  settings.apply({ intent: "update_setting", target: "papers.local_mode", value: true });
  settings.apply({ intent: "update_setting", target: "profile.local_enabled", value: true });
  expect(createSettingsStore().getState()).toMatchObject({ "papers.local_mode": true, "profile.local_enabled": true, "profile.enabled": false });
  for (let index = 0; index < 505; index += 1) recordLocalResearchSignal({ kind: "paper_opened", title: `Graph study ${index}` });
  const profile = loadLocalResearchProfile();
  expect(profile.events).toHaveLength(500);
  expect(localProfileTags(profile).length).toBeLessThanOrEqual(24);
});

test.each([
  ["openalex", { results: [{ id: "https://openalex.org/W1", display_name: "Graph networks", publication_year: 2026, cited_by_count: 9 }] }],
  ["semantic-scholar", { data: [{ paperId: "s2-id", title: "Graph networks", year: 2026, citationCount: 9 }] }],
] as const)("normalizes %s direct results without inventing a cloud fulltext grant", async (provider, payload) => {
  api.mockResolvedValue(new Response(JSON.stringify(payload)));
  const items = await fetchLocalRecommendations({ provider, endpoint: "https://papers.example.test/v1" }, ["graph"], "frontier", new AbortController().signal);
  expect(items[0]).toMatchObject({ title: "Graph networks", citationCount: 9, source: provider });
  expect(items[0].openAccessAvailable).toBeUndefined();
  expect(api.mock.calls[0][1]).toContain("https://papers.example.test/v1/");
});


test("default public metadata service also powers recommendations without local-mode opt-in or a login", async () => {
  api.mockImplementation(async () => result());
  const cloud = vi.fn();
  const { result: hook } = renderHook(() => useKnowledgeSyncController({ ...params, localMode: false, personalizationEnabled: false,
    documentMetadataTransport: cloud, recommendationTransport: cloud }));
  await waitFor(() => expect(hook.current.model.recommendationItems).toHaveLength(1));
  expect(hook.current.model.localRecommendations).toBe(true);
  expect(cloud).not.toHaveBeenCalled();
  await act(async () => { hook.current.actions.refreshRecommendations(); });
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
});
