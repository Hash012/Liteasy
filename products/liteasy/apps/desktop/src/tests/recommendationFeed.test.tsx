import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useRecommendationFeed, type FeedInput } from "../app/features/recommendations/useRecommendationFeed";
import { defaultRecommendationPreferences } from "../app/features/recommendations/recommendationPreferences";
import { createSettingsStore } from "../app/features/settings/settings.store";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";

const { discover, enrich, generate } = vi.hoisted(() => ({ discover: vi.fn(), enrich: vi.fn(), generate: vi.fn() }));
vi.mock("../app/features/recommendations/localRecommendationClient", () => ({ fetchLocalRecommendations: discover }));
vi.mock("../app/features/recommendations/recommendationPaperEvidence", () => ({ enrichRecommendationCandidates: enrich }));
vi.mock("../app/features/models/modelRuntime", () => ({ createModelGatewayFromSettings: () => ({ generateAnswer: generate }) }));
const candidate: RecommendationItem = { id: "public-paper", title: "Filtered vector search", source: "crossref", sourceKind: "live", discoveredAt: "2026-10-15", relatedDocumentTitle: "Vector search", reason: "", relevanceScore: .9, relevanceBand: "high" };
function setup(): FeedInput {
  const scope = crypto.randomUUID();
  return { scope, workspace: scope, enabled: true, direct: true, accountSession: null, endpoint: "", pending: false, style: "balanced",
    config: { provider: "crossref", endpoint: "https://api.crossref.org" }, modelSettings: { ...createSettingsStore().getState(), "models.connection_mode": "direct" },
    preferences: { ...defaultRecommendationPreferences, generationEnabled: true },
    context: { documents: [{ id: "seed", title: "Vector search", abstract: "A study of filtered vector index traversal." }], warnings: [], views: [{ id: "paper:seed", title: "Vector search", revision: "1", kind: "document", provenance: "metadata", private: false, text: "I want to study graph traversal for filtered vector search." }] } };
}
function answer(prompt: string) {
  const input = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1)), source = input.evidence[0], paper = input.candidates[0], section = paper.sections[0];
  return { answer: JSON.stringify({ reasons: [{ candidateId: paper.candidateId, score: 92, evidenceIds: [source.evidenceId], role: "next_read", basis: section.section,
    text: "这篇论文在图遍历时应用过滤条件，可直接用于比较检索召回与延迟。", limitation: "仅阅读引言节选。",
    quotes: [{ evidenceId: source.evidenceId, hash: source.hash, text: source.text.slice(0, 20) }],
    candidateQuotes: [{ section: section.section, hash: section.hash, text: section.text.slice(0, 30) }] }] }) };
}
beforeEach(() => {
  localStorage.clear(); vi.stubGlobal("crypto", webcrypto);
  discover.mockReset().mockResolvedValue([candidate]);
  enrich.mockReset().mockImplementation(async (_config, items) => items.map((item: RecommendationItem) => ({ ...item, introduction: "Our method applies filters during graph traversal to improve filtered vector search recall and latency." })));
  generate.mockReset().mockImplementation(async ({ prompt }) => answer(prompt));
});
afterEach(() => vi.unstubAllGlobals());

test("an empty feed can discover, read introductions and publish a persistent AI selection in one explicit action", async () => {
  discover.mockResolvedValueOnce([]);
  const input = setup(), hook = renderHook(() => useRecommendationFeed(input));
  await waitFor(() => expect(hook.result.current.recommendationStatus).toBe("ready"));
  expect(generate).not.toHaveBeenCalled(); expect(hook.result.current.recommendationItems).toHaveLength(0);
  await act(async () => hook.result.current.curateRecommendations());
  expect(discover).toHaveBeenCalledTimes(2); expect(enrich).toHaveBeenCalledOnce(); expect(generate).toHaveBeenCalledOnce();
  expect(generate.mock.calls[0][0].prompt).toContain("Our method applies filters during graph traversal");
  expect(hook.result.current.recommendationItems[0].researchReason?.basis).toBe("introduction");
  expect(hook.result.current.recommendationMessage).toContain("AI 已精选 1 篇");
  hook.unmount();
  const reopened = renderHook(() => useRecommendationFeed(input));
  await waitFor(() => expect(reopened.result.current.recommendationItems[0]?.researchReason?.basis).toBe("introduction"));
  expect(discover).toHaveBeenCalledTimes(2); expect(generate).toHaveBeenCalledOnce();
});

test("a failed model preserves candidates and four explicit retries remain usable", async () => {
  const input = setup(), hook = renderHook(() => useRecommendationFeed(input));
  await waitFor(() => expect(hook.result.current.recommendationItems).toHaveLength(1));
  generate.mockRejectedValueOnce(new Error("AI 连接暂时中断，请重试。"));
  await act(async () => hook.result.current.curateRecommendations());
  expect(hook.result.current.recommendationItems[0].id).toBe(candidate.id);
  expect(hook.result.current.recommendationMessage).toContain("AI 连接暂时中断");
  for (let index = 0; index < 4; index++) {
    await act(async () => hook.result.current.curateRecommendations());
    expect(hook.result.current.recommendationItems[0].researchReason?.basis).toBe("introduction");
    expect(hook.result.current.recommendationPending).toBe(false);
  }
  expect(generate).toHaveBeenCalledTimes(5);
});

test("changing authorization during reading clears busy state and prevents the old AI request", async () => {
  const input = setup();
  let finish!: (items: RecommendationItem[]) => void;
  enrich.mockImplementationOnce(() => new Promise<RecommendationItem[]>(resolve => { finish = resolve; }));
  const hook = renderHook(({ value }) => useRecommendationFeed(value), { initialProps: { value: input } });
  await waitFor(() => expect(hook.result.current.recommendationItems).toHaveLength(1));
  let pending!: Promise<void>;
  act(() => { pending = hook.result.current.curateRecommendations(); });
  await waitFor(() => expect(enrich).toHaveBeenCalledOnce());
  hook.rerender({ value: { ...input, enabled: false, preferences: { ...input.preferences, consentEpoch: input.preferences.consentEpoch + 1 } } });
  expect(hook.result.current.recommendationPending).toBe(false);
  expect(hook.result.current.recommendationStatus).toBe("disabled");
  await act(async () => { finish([{ ...candidate, introduction: "Old source content" }]); await pending; });
  expect(generate).not.toHaveBeenCalled();
  expect(hook.result.current.recommendationItems).toEqual([]);
  hook.rerender({ value: { ...input, preferences: { ...input.preferences, consentEpoch: input.preferences.consentEpoch + 2 } } });
  await waitFor(() => expect(hook.result.current.recommendationPending).toBe(false));
  await act(async () => hook.result.current.curateRecommendations());
  expect(generate).toHaveBeenCalledOnce();
});


test("a cloud outage falls back to public bibliographic seeds without redirecting private context", async () => {
  const input = setup(), cloud = vi.fn().mockRejectedValue(new Error("Cloud unavailable"));
  const privateDocument = { id: "private-note", title: "PRIVATE unpublished question", abstract: "Private research text" };
  input.direct = false; input.accountSession = { sessionId: "session", email: "test@example.test", name: "Test", membershipTier: "pro", expiresAt: "2027-01-01" };
  input.preferences = { ...input.preferences, sendPrivateText: true, useProfile: true };
  input.generator = { fetch: cloud };
  input.context.documents.push(privateDocument);
  input.context.views.push({ id: privateDocument.id, title: privateDocument.title, revision: "1", kind: "document", provenance: "asset", private: true, text: privateDocument.abstract });
  const hook = renderHook(() => useRecommendationFeed(input));
  await waitFor(() => expect(hook.result.current.recommendationItems).toHaveLength(1));
  expect(cloud).toHaveBeenCalledOnce(); expect(discover).toHaveBeenCalledOnce();
  expect(discover.mock.calls[0][0]).toEqual({ provider: "crossref", endpoint: "https://api.crossref.org" });
  expect(discover.mock.calls[0][1].map((doc: { id: string }) => doc.id)).toEqual(["seed"]);
  expect(JSON.stringify(discover.mock.calls[0][1])).not.toContain("PRIVATE");
});

test("a concurrent refresh cannot clear AI progress or start another discovery", async () => {
  const input = setup();
  let finish!: (value: ReturnType<typeof answer>) => void, prompt = "";
  generate.mockImplementationOnce((request: { prompt: string }) => { prompt = request.prompt; return new Promise(resolve => { finish = resolve; }); });
  const hook = renderHook(() => useRecommendationFeed(input));
  await waitFor(() => expect(hook.result.current.recommendationItems).toHaveLength(1));
  let pending!: Promise<void>;
  act(() => { pending = hook.result.current.curateRecommendations(); });
  await waitFor(() => expect(generate).toHaveBeenCalledOnce());
  await act(async () => hook.result.current.refreshRecommendations());
  expect(discover).toHaveBeenCalledOnce();
  expect(hook.result.current.recommendationPending).toBe(true);
  expect(hook.result.current.recommendationMessage).toContain("AI 正在阅读");
  await act(async () => { finish(answer(prompt)); await pending; });
  expect(hook.result.current.recommendationPending).toBe(false);
  expect(hook.result.current.recommendationMessage).toContain("AI 已精选");
});
