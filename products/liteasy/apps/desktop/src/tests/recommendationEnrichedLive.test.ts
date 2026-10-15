import "fake-indexeddb/auto";
import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { webcrypto } from "node:crypto";
import { expect, test, vi } from "vitest";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { getDefaultModelForProvider } from "../app/features/models/modelPolicy";
import { getDirectModelConfig } from "../app/features/models/modelProviders";
import { saveDirectModelKey, deleteDirectModelKey } from "../app/features/models/directModelTransport";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { RecommendationFeedCoordinator } from "../app/features/recommendations/recommendationCoordinator";
import { curateRecommendationSnapshot } from "../app/features/recommendations/recommendationResearchEnhancer";
import { defaultRecommendationPreferences } from "../app/features/recommendations/recommendationPreferences";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";

const envPath = process.env.LITEASY_RECOMMENDATION_LIVE_ENV;
const candidatesPath = process.env.LITEASY_RECOMMENDATION_ENRICHED_INPUT;
/** Opt-in integration: real fetched public text -> configured HTTP model -> durable feed. */
test.skipIf(!envPath || !candidatesPath)("actual abstracts and introductions guide live AI ranking and survive reopening the feed", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const env = parseEnv(await readFile(envPath!, "utf8"));
  const provider = env.LITEASY_MODEL_PROVIDER || "openai";
  const apiKey = provider === "deepseek" ? env.DEEPSEEK_API_KEY : env.OPENAI_API_KEY;
  const endpoint = (provider === "deepseek" ? env.DEEPSEEK_BASE_URL : env.OPENAI_BASE_URL)?.replace(/\/$/, "");
  const model = (provider === "deepseek" ? env.DEEPSEEK_MODEL : env.OPENAI_MODEL) || getDefaultModelForProvider(provider);
  if (!apiKey || !endpoint || !model) throw new Error("Configured live model is incomplete; no request sent");
  const settings = { ...createSettingsStore().getState(), "models.connection_mode": "direct" as const,
    "models.direct_provider": provider, "models.direct_endpoint": endpoint, "models.direct_model": model,
    "models.direct_protocol": "openai" as const, "models.direct_output_format": "json_object" as const };
  const config = getDirectModelConfig(settings);
  const items = JSON.parse(await readFile(candidatesPath!, "utf8")) as RecommendationItem[];
  expect(items).toHaveLength(2);
  for (const item of items) {
    expect(item.abstract!.length).toBeGreaterThan(100);
    expect(item.introduction!.length).toBeGreaterThan(100);
    expect(item.contentEvidence?.map(row => row.section).sort()).toEqual(["abstract", "introduction"]);
    expect(item.contentEvidence?.every(row => /^https:\/\//.test(row.sourceUrl) && /^[a-f0-9]{64}$/.test(row.textHash))).toBe(true);
  }
  const cases = [
    { name: "language-model-scaling", expected: "arxiv:2401.02954v1", question: "我研究开放语言模型的扩展规律，关注7B与67B规模的训练数据和模型架构，以及引言中LLaMA为何成为后续开放模型的架构与性能基准。请从候选中选择直接相关论文，理由需同时联系摘要中的研究方法与引言中的研究背景，不要把其他领域仅有宽泛词汇重合的论文当成相关工作。" },
    { name: "host-apoptosis", expected: "doi:10.1371/journal.pone.0029565", question: "我研究病原微生物与宿主细胞的相互作用，关注程序性细胞死亡作为防御机制、凋亡程序在不同动物类群的保守性，以及抗凋亡能力怎样影响细胞内感染。请选择直接相关论文，同时用摘要中的实验问题和引言中的机制背景说明阅读价值。" }
  ];
  const results: Record<string, unknown>[] = [], usage: unknown[] = [];
  let requests = 0;
  const actualFetch = globalThis.fetch;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    requests++;
    const response = await actualFetch(url, init);
    if (response.ok) { const payload = await response.clone().json() as { usage?: unknown }; usage.push(payload.usage ?? null); }
    return response;
  });
  let status = "failed", failure = "";
  const started = performance.now();
  await saveDirectModelKey(config, apiKey);
  try {
    for (const entry of cases) {
      const scope = `public-ai-evaluation-${crypto.randomUUID()}`;
      const storage = createObjectStorage(scope, () => scope);
      const options = { storage, scope, key: "feed", workspaceId: "public-evaluation", provider: "public-evaluation", sourceRevision: () => entry.name };
      const coordinator = new RecommendationFeedCoordinator(options);
      await coordinator.seedLegacy(items);
      const context = { documents: [], warnings: [], views: [{ id: `question:${entry.name}`, title: "本次研究问题", text: entry.question,
        revision: entry.name, kind: "document" as const, provenance: "metadata" as const, private: false }] };
      const selected = await coordinator.refresh("ai_curate", async task => (await curateRecommendationSnapshot({ items, context, settings, task,
        preferences: { ...defaultRecommendationPreferences, generationEnabled: true } })).items);
      expect(selected.message ?? "", selected.message).toBe("");
      expect(selected.current?.selection).toBe("ai");
      expect(selected.current?.items[0].id).toBe(entry.expected);
      const top = selected.current!.items[0];
      expect(top.researchReason?.basis).toBe("abstract_and_introduction");
      expect(top.researchReason?.candidateEvidence?.map(row => row.section).sort()).toEqual(["abstract", "introduction"]);
      const reopened = await new RecommendationFeedCoordinator(options).read();
      expect(reopened.current?.items).toEqual(selected.current?.items);
      expect(reopened.previous?.items.map(row => row.id)).toEqual(items.map(row => row.id));
      await coordinator.restorePrevious();
      expect((await coordinator.read()).current?.items.map(row => row.id)).toEqual(items.map(row => row.id));
      results.push({ case: entry.name, expectedFirst: entry.expected, selected: selected.current?.items.map(item => ({ id: item.id, title: item.title,
        reason: item.reason, score: item.researchReason?.score, basis: item.researchReason?.basis, candidateEvidence: item.researchReason?.candidateEvidence })),
        ledger: selected.usage, persistedAfterReopen: true, originalCandidatesRestored: true });
    }
    expect(requests).toBe(2);
    status = "passed";
  } catch (error) { failure = error instanceof Error ? error.message : "live_integration_failed"; }
  finally { fetchSpy.mockRestore(); await deleteDirectModelKey(config); }
  const report = { status, failure, provider, requestedModel: model, protocol: "json_object", requests, usage,
    elapsedMs: Math.round(performance.now() - started), sourceInput: candidatesPath,
    sourceBoundary: "public live-enrichment artifact with exact content hashes; no private library content", cases: results,
    persistenceBoundary: "production coordinator and ObjectStorage backed by test IndexedDB; not Windows native SQLite" };
  if (process.env.LITEASY_RECOMMENDATION_ENRICHED_REPORT) await writeFile(process.env.LITEASY_RECOMMENDATION_ENRICHED_REPORT, JSON.stringify(report, null, 2) + "\n");
  expect(status, failure).toBe("passed");
}, 340_000);
