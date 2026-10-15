import { readFile, writeFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { parseEnv } from "node:util";
import { expect, test, vi } from "vitest";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { getDefaultModelForProvider } from "../app/features/models/modelPolicy";
import { getDirectModelConfig } from "../app/features/models/modelProviders";
import { saveDirectModelKey, deleteDirectModelKey } from "../app/features/models/directModelTransport";
import { curateRecommendationSnapshot } from "../app/features/recommendations/recommendationResearchEnhancer";
import { defaultRecommendationPreferences } from "../app/features/recommendations/recommendationPreferences";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";
import type { RecommendationTask } from "../app/features/recommendations/recommendationCoordinator";

const envPath = process.env.LITEASY_RECOMMENDATION_LIVE_ENV;
/** Explicit live run only: public excerpts and synthetic interest, never a user's library. */
test.skipIf(!envPath)("configured real model ranks public abstract excerpts and returns verifiable reasons", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const env = parseEnv(await readFile(envPath!, "utf8"));
  const provider = env.LITEASY_MODEL_PROVIDER || "openai";
  const apiKey = provider === "deepseek" ? env.DEEPSEEK_API_KEY : env.OPENAI_API_KEY;
  const endpoint = (provider === "deepseek" ? env.DEEPSEEK_BASE_URL : env.OPENAI_BASE_URL)?.replace(/\/$/, "");
  const model = (provider === "deepseek" ? env.DEEPSEEK_MODEL : env.OPENAI_MODEL) || getDefaultModelForProvider(provider);
  if (!apiKey || !endpoint || !model) throw new Error("Configured live model is incomplete; no request sent");
  const store = createSettingsStore();
  const settings = { ...store.getState(), "models.connection_mode": "direct" as const, "models.direct_provider": provider,
    "models.direct_endpoint": endpoint, "models.direct_model": model, "models.direct_protocol": "openai" as const,
    "models.direct_output_format": "json_object" as const };
  const config = getDirectModelConfig(settings);
  const base = { source: "arxiv", sourceKind: "live" as const, discoveredAt: "2026-10-15T00:00:00Z", relatedDocumentTitle: "过滤向量检索", relevanceBand: "high" as const, relevanceScore: .8, reason: "检索候选" };
  // Exact abstract excerpts from the repository's pre-existing ACORN/ColBERT PDF fixtures.
  const items: RecommendationItem[] = [
    { ...base, id: "arxiv:2403.04871", title: "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data", sourceUrl: "https://arxiv.org/abs/2403.04871",
      abstract: "Applications increasingly leverage mixed-modality data, and must jointly search over vector data , such as embedded images, text and video, as well as structured data , such as attributes and keywords. Proposed methods for this hybrid search setting either suffer from poor performance or support a severely restricted set of search predicates ( e.g., only small sets of equality predicates), making them impractical for many applications. To address this, we present ACORN, an approach for performant and predicate-agnostic hybrid search. ACORN builds on Hierarchical Navigable Small Worlds (HNSW), a state-of-the-art graph-based approximate nearest neighbor index, and can be implemented efficiently by extending existing HNSW libraries. ACORN introduces the idea of predicate subgraph traversal to emulate a theoretically ideal, but impractical, hybrid search strategy. ACORN’s predicate-agnostic construction algorithm is designed to enable this effective search strategy, while supporting a wide array of predicate sets and query semantics. We systematically evaluate ACORN on both prior benchmark datasets, with simple, low-cardinality predicate sets, and complex multi-modal datasets not supported by prior methods." },
    { ...base, id: "arxiv:2004.12832", title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT", sourceUrl: "https://arxiv.org/abs/2004.12832",
      abstract: "Recent progress in Natural Language Understanding (NLU) is driving fast-paced advances in Information Retrieval (IR), largely owed to fine-tuning deep language models (LMs) for document ranking. While remarkably effective, the ranking models based on these LMs increase computational cost by orders of magnitude over prior approaches, particularly as they must feed each query–document pair through a massive neural network to compute a single relevance score. To tackle this, we present ColBERT, a novel ranking model that adapts deep LMs (in particular, BERT) for efficient retrieval. ColBERT introduces a late interaction architecture that independently encodes the query and the document using BERT and then employs a cheap yet powerful interaction step that models their fine-grained similarity. By delaying and yet retaining this finegranular interaction, ColBERT can leverage the expressiveness of deep LMs while simultaneously gaining the ability to pre-compute document representations offline, considerably speeding up query processing. Beyond reducing the cost of re-ranking the documents retrieved by a traditional model, ColBERT’s pruning-friendly interaction mechanism enables leveraging vector-similarity indexes for end-to-end retrieval directly from a large document collection. We extensively evaluate ColBERT using two recent passage search datasets." }
  ];
  const question = "我想研究带结构化过滤条件的向量近邻检索，尤其关心过滤条件变化、索引遍历方法、吞吐和召回之间的权衡。优先推荐直接提出过滤检索算法的工作，纯文本语义匹配只作为背景。";
  const context = { documents: [], warnings: [], views: Array.from({ length: 6 }, (_, index) => ({ id: `public-topic-${index}`, title: "混合检索研究问题",
    text: question.repeat(5), revision: JSON.stringify({ question, abstract: question.repeat(100) }), kind: "document" as const,
    provenance: "metadata" as const, private: false })) };
  const usage: unknown[] = [], reserved: number[] = [];
  let requests = 0;
  const actualFetch = globalThis.fetch;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    requests++;
    const response = await actualFetch(url, init);
    if (response.ok) { const body = await response.clone().json() as { usage?: unknown }; usage.push(body.usage ?? null); }
    return response;
  });
  const task: RecommendationTask = { signal: AbortSignal.timeout(150_000), active: async () => true, upstreamUnknown: () => {},
    request: async (_kind, run, units) => { reserved.push(units ?? 0); return run(); } };
  let status = "failed", reason = "", result: Awaited<ReturnType<typeof curateRecommendationSnapshot>> | undefined;
  const started = performance.now();
  await saveDirectModelKey(config, apiKey);
  try {
    result = await curateRecommendationSnapshot({ items, context, preferences: { ...defaultRecommendationPreferences, generationEnabled: true }, settings, task });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].id).toBe("arxiv:2403.04871");
    expect(result.items.every(item => item.researchReason?.candidateEvidence?.length && item.researchReason.text.length >= 20)).toBe(true);
    expect(requests).toBe(1); expect(result.evaluatedCount).toBe(2);
    status = "passed";
  } catch (error) { reason = error instanceof Error ? error.message : "generation_failed"; }
  finally { fetchSpy.mockRestore(); await deleteDirectModelKey(config); }
  const report = { status, provider, requestedModel: model, actualModelIdentity: "not exposed by production gateway", protocol: "json_object",
    requests, reservedTokens: reserved, usage, elapsedMs: Math.round(performance.now() - started), cost: "not_reported_by_provider", reason,
    evaluatedCount: result?.evaluatedCount, selected: result?.items.map(item => ({ id: item.id, title: item.title, reason: item.reason, score: item.researchReason?.score,
      candidateEvidence: item.researchReason?.candidateEvidence })), sourceCoverage: "public abstract excerpts only; not complete papers or Windows runtime" };
  if (process.env.LITEASY_RECOMMENDATION_LIVE_REPORT) await writeFile(process.env.LITEASY_RECOMMENDATION_LIVE_REPORT, JSON.stringify(report, null, 2) + "\n");
  expect(status, reason).toBe("passed");
}, 170_000);
