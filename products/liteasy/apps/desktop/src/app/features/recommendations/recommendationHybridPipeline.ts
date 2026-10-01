import type { AgentAssetService } from "../resource-filesystem/agentAssetService";
import { hybridRank, diversify, cosine, keywords, terms, type Candidate } from "../../../../../../packages/recommendation-core/index.mjs";
import { contentFingerprint, createSemanticIndex, type IndexRecord } from "../semantic-index/semanticIndexClient";
import { embedTexts, embeddingFingerprint, localEmbedding, rerankTexts } from "../semantic-index/embeddingProvider";
import type { RecommendationContext } from "./recommendationContext";
import type { RecommendationPreferences } from "./recommendationPreferences";
import type { RecommendationItem, RecommendationStyle } from "./recommendation.types";
import { rankRecommendations } from "./recommendationRanking";

const textOf = (item: Candidate) => [item.title, item.abstract, ...(item.subjects ?? []), ...(item.keywords ?? [])].filter(Boolean).join("\n").slice(0, 8000);
function candidate(value: unknown): value is RecommendationItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RecommendationItem>;
  return typeof item.id === "string" && typeof item.title === "string" && typeof item.source === "string" && typeof item.relevanceScore === "number";
}
function link(title: string, path?: string) {
  const label = title.replace(/[\[\]\\\n]/g, " ").slice(0, 100);
  return path?.startsWith("liteasy://") ? `[《${label}》](${path.replace(/[()\s]/g, encodeURIComponent)})` : `《${label}》`;
}
export async function rankContextRecommendations(input: { assets?: AgentAssetService; items: RecommendationItem[]; context: RecommendationContext; preferences: RecommendationPreferences; scope: string; workspace: string;
  style: RecommendationStyle; signal: AbortSignal; active(): boolean }): Promise<{ items: RecommendationItem[]; warning: string }> {
  const { preferences, context } = input;
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(45_000)]);
  const check = () => { signal.throwIfAborted(); if (!input.active()) throw new Error("推荐工作区已切换。"); };
  const config = preferences.embedding;
  const semantic = Boolean(preferences.hybridEnabled && config.endpoint && config.model && config.dimensions);
  const model = semantic ? embeddingFingerprint(config) : "lexical-v1";
  const index = createSemanticIndex({ scope: input.scope, workspace: input.workspace, model, active: input.active });
  const views = context.views.map((view) => ({ ...view }));
  let items: (RecommendationItem & { vector?: number[] })[] = [...input.items, ...(context.localCandidates ?? [])], warning = "";
  const vectorByText = new Map<string, number[]>();
  const vectorize = async (entries: { id: string; text: string; path: string; private?: boolean; payload?: unknown }[]) => {
    const records: (IndexRecord & { private?: boolean })[] = await Promise.all(entries.map(async (entry) => {
      const revision = await contentFingerprint(entry.text);
      return { ...entry, id: `${entry.id}:${revision}`, revision, tokens: terms(entry.text).join(" ") };
    }));
    for (let offset = 0; offset < records.length; offset += 16) {
      check();
      const batch = records.slice(offset, offset + 16);
      const cached = await index.lookup(batch.filter((record) => !record.id.startsWith("profile:")).map((record) => record.id), signal);
      cached.forEach((record) => { if (record.vector) vectorByText.set(record.text, record.vector); });
      const missing = batch.filter((record) => !vectorByText.has(record.text) && (!record.private || localEmbedding(config) || preferences.sendPrivateText));
      if (semantic && missing.length) {
        const vectors = await embedTexts(config, missing.map((record) => record.text), signal);
        check(); missing.forEach((record, i) => vectorByText.set(record.text, vectors[i]));
      }
      // Asset cache hits are checked against the live repository below. Profile/query-only fragments remain transient.
      const persistent = batch.filter((record) => !record.private || candidate(record.payload) && record.payload.resourcePath).map((record) => ({ ...record, vector: vectorByText.get(record.text) }));
      if (persistent.length) await index.upsert(persistent, signal);
    }
  };
  try {
    await vectorize(views.map((view) => ({ id: view.id, path: view.path || view.id, text: view.text, private: view.private })));
    views.forEach((view) => { view.vector = vectorByText.get(view.text); });
    let privateHits = 0;
    for (const view of views.filter((view) => view.kind !== "profile").slice(0, 12)) {
      for (const hit of await index.search(view.text, view.vector, signal)) {
        const payload = hit.payload;
        if (!candidate(payload) || items.some((item) => item.id === payload.id)) continue;
        if (payload.resourcePath) {
          if (!input.assets || ++privateHits > 24 || context.documents.some((doc) => doc.id === payload.resourcePath)) continue;
          try {
            const current = await input.assets.stat(payload.resourcePath, { signal });
            if (!payload.resourceRevision || current.revision !== payload.resourceRevision) { await index.remove([hit.path], signal); continue; }
          } catch { check(); await index.remove([hit.path], signal); continue; }
        }
        items.push(payload);
      }
    }
    items = rankRecommendations(items, { selectedDocuments: context.documents }).slice(0, 200);
    await vectorize(items.map((item) => ({ id: item.id, path: item.resourcePath || item.canonicalId || item.id, text: textOf(item), private: Boolean(item.resourcePath), payload: { ...item, reason: "", relatedDocumentTitle: "", relatedDocumentTitles: undefined, contextEvidence: undefined, rankingFusion: undefined, scoreComponents: undefined } })));
    items = items.map((item) => ({ ...item, vector: vectorByText.get(textOf(item)) }));
    // Only assets already read for this request enter the local cache; no background vault crawl.
    await vectorize(views.filter((view) => view.provenance === "asset" && view.path && view.revision).map((view) => ({ id: view.id, path: view.path!, text: view.text, private: true,
      payload: { id: `local:${view.path}`, resourcePath: view.path, resourceRevision: view.revision, title: view.title, abstract: view.text.slice(view.title.length).trim(), source: "本地资产", sourceKind: "cache", discoveredAt: "", relatedDocumentTitle: "", relevanceScore: .5, relevanceBand: "medium", reason: "来自已阅读资产的本地索引。" } })));
  } catch (error) { input.signal.throwIfAborted(); if (!input.active()) throw error; warning = error instanceof Error ? `语义匹配未完成，使用已有缓存与词项检索：${error.message}` : "语义服务暂不可用，已使用词项检索。"; }
  views.forEach((view) => { view.vector = vectorByText.get(view.text); });
  items = items.map((item) => ({ ...item, vector: vectorByText.get(textOf(item)) }));
  let ranked = hybridRank(items, views.map((view) => ({ ...view, text: view.provenance === "highlight" ? view.text.slice(0, 200) : view.text })), { style: input.style });
  if (preferences.reranker.endpoint && preferences.reranker.model && ranked.length) {
    const query = views.filter((view) => !view.private || localEmbedding(preferences.reranker) || preferences.sendPrivateText).map((view) => view.text).join("\n");
    if (query.trim()) try {
      const top = ranked.filter((item) => !item.resourcePath || localEmbedding(preferences.reranker) || preferences.sendPrivateText).slice(0, 30), scores = await rerankTexts(preferences.reranker, query, top.map(textOf), signal);
      check();
      for (const row of scores) top[row.index].hybrid.score = top[row.index].hybrid.score * .8 + row.relevance_score * .2;
      top.sort((a, b) => b.hybrid.score - a.hybrid.score);
      ranked = diversify([...top, ...ranked.filter((item) => !top.includes(item))].map((item) => ({ ...item, hybrid: { ...item.hybrid, score: item.hybrid.score + item.hybrid.diversityPenalty, diversityPenalty: 0 } })), { style: input.style });
    } catch (error) { input.signal.throwIfAborted(); if (!input.active()) throw error; warning = `${warning} 重排服务暂不可用，保留混合排序。`.trim(); }
  }
  if (semantic) try {
    const visible = ranked.filter((item) => item.vector && (!item.resourcePath || localEmbedding(config) || preferences.sendPrivateText)).slice(0, 12);
    const phrases = visible.flatMap((item) => keywords(item, items).filter((tag) => tag.source === "text").slice(0, 3).map((tag) => ({ id: `keyword:${tag.value}`, path: `keyword:${tag.value}`, text: tag.label, private: Boolean(item.resourcePath) })));
    await vectorize(phrases);
    for (const item of visible) item.keywordScores = Object.fromEntries(keywords(item, items).map((tag) => [tag.value, Math.max(0, cosine(item.vector, vectorByText.get(tag.label)))]));
  } catch { input.signal.throwIfAborted(); }
  input.signal.throwIfAborted();
  if (!input.active()) throw new Error("推荐工作区已切换。");
  return { warning, items: ranked.map(({ vector: _vector, hybrid, ...item }) => {
    const finalScore = Math.max(0, Math.min(1, hybrid.score / 1.075));
    const evidence = hybrid.evidence.filter((entry) => entry.kind !== "profile").slice(0, 2);
    const profile = hybrid.evidence.find((entry) => entry.kind === "profile");
    const reason = evidence.map((entry) => `${entry.kind === "annotation" ? "回应相关批注" : "关联文献"} ${link(entry.title, entry.path)}${entry.matched.length ? `：${entry.matched.join("、")}` : "：语义接近"}`).join("\n\n") + (profile ? `\n\n结合研究偏好：${profile.title}` : "");
    return { ...item, reason: reason || item.reason, rankingStyle: input.style,
      contextEvidence: hybrid.evidence,
      rankingFusion: { version: hybrid.version, k: 10, calibratedScore: finalScore, fusionScore: hybrid.routes.reduce((sum, route) => sum + route.contribution, 0), routes: hybrid.routes },
      scoreComponents: { baseRelevance: item.relevanceScore, diversityPenalty: hybrid.diversityPenalty, finalScore, preference: hybrid.preference, sourceRelevance: item.relevanceScore } };
  }) };
}
