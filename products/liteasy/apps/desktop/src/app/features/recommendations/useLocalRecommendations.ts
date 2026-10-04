import type { AgentAssetService } from "../resource-filesystem/agentAssetService";
import { personalizeRecommendationOrder } from "./recommendationPersonalization";
import { hasReadableRecommendationMetadata } from "./recommendationMetadataValidation";
import { useEffect, useRef, useState } from "react";
import type { PaperServiceConfig } from "../paper-services/paperServiceTransport";
import type { RecommendationItem, RecommendationResearchProfile, RecommendationStatus, RecommendationStyle } from "./recommendation.types";
import type { Paper } from "../workspace/workspace.types";
import type { SettingsState } from "../settings/settings.types";
import { rankRecommendations } from "./recommendationRanking";
import { fetchLocalRecommendations } from "./localRecommendationClient";
import { resolveLocalAccountKey } from "../library/localAccountKey";
import { hasRecommendationDescription, recommendationDocument } from "./recommendationSeed";
import type { RecommendationContext } from "./recommendationContext";
import { defaultRecommendationPreferences, type RecommendationPreferences } from "./recommendationPreferences";
import { rankContextRecommendations } from "./recommendationHybridPipeline";
function read<T>(key: string, fallback: T): T { try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null"); return (Array.isArray(value) ? value : fallback) as T; } catch { return fallback; } }
type Feedback = { id: string; action: "saved" | "dismissed"; at: number };
export function useLocalRecommendations(input: { assets?: AgentAssetService; enabled: boolean; config?: PaperServiceConfig; papers: Paper[]; profile?: RecommendationResearchProfile;
  context?: RecommendationContext; contextPending?: boolean; preferences?: RecommendationPreferences; scopeId?: string;
  workspace: string; style: RecommendationStyle; sort: SettingsState["network.recommendation.sort_mode"] }) {
  const preferences = input.preferences ?? defaultRecommendationPreferences;
  const scope = `${resolveLocalAccountKey()}:${input.workspace}`;
  const cacheKey = `liteasy.local-recommendations.v1:${scope}`;
  const feedbackKey = `liteasy.local-recommendation-feedback.v2:${scope}`;
  const oldFeedbackKey = `liteasy.local-recommendation-feedback.v1:${scope}`;
  const documents = (input.context?.documents ?? input.papers.map(recommendationDocument)).filter(hasRecommendationDescription);
  const publicDocuments = documents.filter((document) => !input.context?.views.find((view) => view.id === document.id)?.private || preferences.sendPrivateText);
  const queries = publicDocuments.length ? [...publicDocuments, ...(preferences.sendPrivateText && preferences.useAnnotations ? input.context?.views.filter((view) => view.kind === "annotation" && view.provenance === "user-note").slice(0, 3).map((view) => ({ id: view.id, title: view.title, abstract: view.text })) ?? [] : [])]
    : documents.length || !preferences.useProfile || !preferences.sendPrivateText ? [] : [...new Set([...(input.profile?.topics ?? []).slice(0, 3), ...(input.profile?.methods ?? []).slice(0, 1), ...(input.profile?.datasets ?? []).slice(0, 1)].filter((query) => query.trim()))].slice(0, 3);
  // Preserve the visible list only within the same account, selection and privacy settings.
  const sourceKey = JSON.stringify([scope, input.scopeId, input.enabled, input.config, input.papers.map((paper) => paper.id),
    input.context?.documents.map((document) => document.id), input.style, input.sort, input.profile, preferences]);
  const signature = JSON.stringify([sourceKey, input.enabled, input.contextPending, input.config, queries, input.style, input.sort, input.profile, input.context, preferences]);
  const latest = useRef(signature); latest.current = signature;
  const controller = useRef<AbortController>();
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState({ signature, sourceKey, items: [] as RecommendationItem[], status: "idle" as RecommendationStatus, pending: false, message: "" });
  const retained = state.sourceKey === sourceKey ? state.items : [];
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort;
    const active = () => !abort.signal.aborted && latest.current === signature;
    const update = (next: Partial<typeof state>) => { if (active()) setState((current) => ({ ...current, signature, sourceKey, ...next })); };
    const feedback = () => read<Feedback[]>(feedbackKey, []).filter((row) => row && typeof row.id === "string" && ["saved", "dismissed"].includes(row.action));
    const filter = (items: RecommendationItem[]) => {
      const history = feedback(), hidden = new Set([...read<string[]>(oldFeedbackKey, []), ...history.filter((row) => row.action === "dismissed").map((row) => row.id)]);
      const saved = new Set(history.filter((row) => row.action === "saved").map((row) => row.id));
      const ranked = rankRecommendations(items.filter((item) => !hidden.has(item.canonicalId ?? item.id)).map((item) => saved.has(item.canonicalId ?? item.id) ? { ...item, saved: true } : item), { style: input.style, sortMode: input.sort, selectedDocuments: documents });
      return preferences.hybridEnabled || input.sort === "retrieved_at" ? ranked : personalizeRecommendationOrder(ranked, preferences.useProfile ? input.profile : undefined);
    };
    if (!input.enabled) { update({ items: [], pending: false, status: "disabled", message: "联网推荐已关闭。" }); return () => abort.abort(); }
    if (input.contextPending) { update({ items: retained, pending: true, status: retained.length ? "ready" : "loading", message: "正在准备文献与相关批注…" }); return () => abort.abort(); }
    if (!queries.length && !input.context?.views.length) { update({ items: [], pending: false, status: "idle", message: "选择文献或在个人中心填写研究兴趣，即可获取关联推荐。" }); return () => abort.abort(); }
    const cache = read<{ key: string; items: RecommendationItem[] }[]>(cacheKey, []);
    const cacheId = JSON.stringify(["bibliographic-v4", input.config, queries, input.style]);
    const rawCached = cache.find((entry) => entry?.key === cacheId)?.items;
    const valid = (items: unknown) => Array.isArray(items) ? items.filter((item) => hasReadableRecommendationMetadata(item) && item && typeof item.id === "string" && typeof item.title === "string" && typeof item.relevanceScore === "number") as RecommendationItem[] : [];
    const cached = valid(rawCached);
    const previous = cached.length ? cached : retained;
    update({ items: filter(previous), pending: true, status: previous.length ? "ready" : "loading", message: previous.length ? "已显示本机缓存，正在更新…" : "正在查找关联文献…" });
    const timer = setTimeout(() => { void (async () => {
      let items = previous, notice = "";
      try {
        if (queries.length && navigator.onLine !== false) {
          if (!input.config) throw new Error("请在设置 → 文献服务选择自备 API，并填写地址与密钥。");
          items = await fetchLocalRecommendations(input.config, queries, input.style, abort.signal, { citations: preferences.hybridEnabled, onCandidates: (partial) => { if (partial.length) update({ items: filter(partial), status: "ready", message: "正在补充引用关系与关联匹配…" }); } });
          if (!active()) return;
          try { localStorage.setItem(cacheKey, JSON.stringify([{ key: cacheId, items }, ...cache.filter((entry) => entry?.key !== cacheId)].slice(0, 8))); }
          catch { notice = "本机缓存保存失败，请检查存储空间。"; }
        } else notice = queries.length ? "当前离线，显示本机缓存。" : "笔记正文仅用于本地匹配；可在推荐设置中允许发送个性化内容以扩展联网检索。";
      } catch (error) { if (!active()) return; notice = `联网更新暂不可用，已保留缓存。${String(error)}`; }
      update({ items: filter(items), status: items.length ? "ready" : "loading", message: preferences.hybridEnabled ? "题录已就绪，正在结合阅读关注排序…" : notice });
      try {
        if (preferences.hybridEnabled && input.context?.views.length) {
          const result = await rankContextRecommendations({ assets: input.assets, items: filter(items), context: input.context, preferences, scope: input.scopeId || "local", workspace: input.workspace, style: input.style, signal: abort.signal, active });
          items = result.items; notice = [notice, result.warning].filter(Boolean).join(" ");
        }
        if (!active()) return;
        const selected = filter(items);
        update({ items: selected, status: selected.length || !notice ? "ready" : "error", pending: false,
          message: [`已获取 ${selected.length} 条推荐。`, notice, ...(input.context?.warnings ?? [])].filter(Boolean).join(" ") });
      } catch (error) { update({ items: filter(items), pending: false, status: items.length ? "ready" : "error", message: String(error) }); }
    })(); }, 350);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [signature, refresh]);
  const current = state.signature === signature ? state : { items: retained, status: retained.length ? "ready" as const : "idle" as const, pending: input.enabled, message: "" };
  return { recommendationItems: current.items, recommendationStatus: current.status, recommendationPending: current.pending, recommendationMessage: current.message,
    refreshRecommendations: () => setRefresh((value) => value + 1),
    clearRecommendationCache: async () => { controller.current?.abort(); localStorage.removeItem(cacheKey); setState({ signature, sourceKey, items: [], pending: false, status: "idle", message: "已清除本机推荐缓存。" }); },
    recordRecommendationFeedback: async (candidate: RecommendationItem, action: "saved" | "dismissed") => {
      const rows = read<Feedback[]>(feedbackKey, []); const id = candidate.canonicalId ?? candidate.id;
      try { localStorage.setItem(feedbackKey, JSON.stringify([...rows.filter((value) => value.id !== id), { id, action, at: Date.now() }].slice(-500))); }
      catch { setState((current) => ({ ...current, message: "推荐反馈保存失败，请检查存储空间。" })); return false; }
      setState((current) => ({ ...current, items: action === "dismissed" ? current.items.filter((item) => (item.canonicalId ?? item.id) !== id) : current.items.map((item) => (item.canonicalId ?? item.id) === id ? { ...item, saved: true } : item), message: "反馈已保存到本机。" }));
      return true;
    },
  };
}
