import { afterEach, expect, test, vi } from "vitest";
import { createSemanticIndex } from "../app/features/semantic-index/semanticIndexClient";
import { embedTexts, embeddingFingerprint } from "../app/features/semantic-index/embeddingProvider";
import { rankContextRecommendations } from "../app/features/recommendations/recommendationHybridPipeline";
import { defaultRecommendationPreferences } from "../app/features/recommendations/recommendationPreferences";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";
const scope = () => crypto.randomUUID();
afterEach(() => vi.unstubAllGlobals());

test("index cache is isolated by account, workspace and model, and invalidates old revisions", async () => {
  const account = scope(), options = { scope: account, workspace: "work", model: "model-a", active: () => true };
  const index = createSemanticIndex(options);
  await index.upsert([{ id: "r1", path: "p", revision: "1", text: "database transaction", tokens: "database transaction", vector: [1, 0] }]);
  expect(await index.search("database")).toHaveLength(1);
  for (const change of [{ scope: scope() }, { workspace: "other" }, { model: "model-b" }]) expect(await createSemanticIndex({ ...options, ...change }).search("database", [1, 0])).toEqual([]);
  await index.upsert([{ id: "r2", path: "p", revision: "2", text: "episodic memory", tokens: "episodic memory" }]);
  expect(await index.lookup(["r1"])).toEqual([]); expect(await index.search("database")).toEqual([]);
  await index.remove(["p"]); expect(await index.search("memory")).toEqual([]);
  const abort = new AbortController(); abort.abort(); await expect(index.search("memory", undefined, abort.signal)).rejects.toThrow();
});

test("embedding responses must match index positions, dimensions and finite nonzero vectors", async () => {
  const config = { endpoint: "https://embedding.test/v1", model: "multi", dimensions: 2 };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: [{ index: 0, embedding: [1, 0] }] })));
  expect(await embedTexts(config, ["database"], new AbortController().signal)).toEqual([[1, 0]]);
  for (const data of [[{ index: 0, embedding: [1, 0, 0] }], [{ index: 1, embedding: [1, 0] }], [{ index: 0, embedding: [0, 0] }]]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data })));
    await expect(embedTexts(config, ["database"], new AbortController().signal)).rejects.toThrow("维度");
  }
  expect(embeddingFingerprint(config)).not.toBe(embeddingFingerprint({ ...config, model: "another" }));
});

test("private annotations/profile/local assets stay out of remote embeddings and reranking by default", async () => {
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(new TextDecoder().decode(init.body as Uint8Array)); requests.push(JSON.stringify(body));
    return Response.json(body.input ? { data: body.input.map((_: unknown, index: number) => ({ index, embedding: [1, 0] })) } : { results: [{ index: 0, relevance_score: .8 }] });
  }));
  const item = { id: "paper", title: "Database transaction ordering", abstract: "Serializable database transactions", source: "crossref", sourceKind: "live", discoveredAt: "", relatedDocumentTitle: "", relevanceScore: .8, relevanceBand: "high", reason: "" } as RecommendationItem;
  const result = await rankContextRecommendations({ items: [item], context: { documents: [], warnings: [], views: [
    { id: "doc", kind: "document", title: "Database", text: "database transaction concurrency", revision: "r1", private: false, provenance: "metadata" },
    { id: "secret-note", kind: "annotation", title: "Question", text: "PRIVATE QUESTION database transaction", revision: "r1", private: true, provenance: "user-note", path: "liteasy://objects/note" },
    { id: "profile:topic", kind: "profile", title: "PRIVATE PROFILE", text: "PRIVATE PROFILE database", revision: "r1", private: true, provenance: "profile" },
  ] }, preferences: { ...defaultRecommendationPreferences, hybridEnabled: true, embedding: { endpoint: "https://embedding.test", model: "multi", dimensions: 2 }, reranker: { endpoint: "https://rerank.test", model: "rank" } }, scope: scope(), workspace: "work", style: "balanced", signal: new AbortController().signal, active: () => true });
  expect(result.items).toHaveLength(1); expect(requests.length).toBeGreaterThan(1);
  expect(requests.join("\n")).not.toContain("PRIVATE");
  expect(result.items[0].reason).toContain("](liteasy://objects/note)");
  expect(result.items[0].rankingFusion?.routes.length).toBeGreaterThan(0);
});

test("cached local notes are revalidated before recall and disappear after revision changes or deletion", async () => {
  const account = scope(), path = "liteasy://objects/private-note?scope=local";
  const preferences = { ...defaultRecommendationPreferences, hybridEnabled: true };
  const base = { items: [], preferences, scope: account, workspace: "work", style: "balanced" as const, signal: new AbortController().signal, active: () => true };
  await rankContextRecommendations({ ...base, context: { documents: [{ id: path, title: "Database note", abstract: "database transaction concurrency" }], warnings: [], views: [
    { id: path, path, kind: "document", title: "Database note", text: "Database note\ndatabase transaction concurrency", revision: "r1", private: true, provenance: "asset" },
  ] } });
  const stat = vi.fn().mockResolvedValue({ revision: "r1" });
  const next = { ...base, assets: { stat } as unknown as import("../app/features/resource-filesystem/agentAssetService").AgentAssetService,
    context: { documents: [], warnings: [], views: [{ id: "public", kind: "document" as const, title: "Transactions", text: "database transaction concurrency", revision: "1", private: false, provenance: "metadata" as const }] } };
  expect((await rankContextRecommendations(next)).items[0]?.resourcePath).toBe(path);
  stat.mockResolvedValue({ revision: "r2" });
  expect((await rankContextRecommendations(next)).items).toEqual([]);
  stat.mockRejectedValue(new Error("deleted"));
  expect((await rankContextRecommendations(next)).items).toEqual([]);
});
