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
function read<T>(key: string, fallback: T): T { try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null"); return (Array.isArray(value) ? value : fallback) as T; } catch { return fallback; } }
export function useLocalRecommendations(input: { enabled: boolean; config?: PaperServiceConfig; papers: Paper[]; profile?: RecommendationResearchProfile;
  workspace: string; style: RecommendationStyle; sort: SettingsState["network.recommendation.sort_mode"] }) {
  const scope = `${resolveLocalAccountKey()}:${input.workspace}`;
  const cacheKey = `liteasy.local-recommendations.v1:${scope}`;
  const feedbackKey = `liteasy.local-recommendation-feedback.v1:${scope}`;
  const documents = input.papers.slice(0, 2).map(recommendationDocument).filter(hasRecommendationDescription);
  // Saved reading-interest words can themselves be old filenames/acronyms. They
  // must not reopen a broad, unrelated search beside a selected verified paper.
  const queries = documents.length ? documents : [...new Set([...(input.profile?.topics ?? []).slice(0, 3), ...(input.profile?.methods ?? []).slice(0, 1), ...(input.profile?.datasets ?? []).slice(0, 1)].filter((query) => query.trim()))].slice(0, 3);
  const signature = JSON.stringify([scope, input.enabled, input.config, queries, input.style, input.sort, input.profile]);
  const latest = useRef(signature); latest.current = signature;
  const controller = useRef<AbortController>();
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState({ signature, items: [] as RecommendationItem[], status: "idle" as RecommendationStatus, pending: false, message: "" });
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort;
    const active = () => !abort.signal.aborted && latest.current === signature;
    const update = (next: Partial<typeof state>) => { if (active()) setState((current) => ({ ...current, signature, ...next })); };
    const filter = (items: RecommendationItem[]) => {
      const hidden = new Set(read<string[]>(feedbackKey, []));
      const ranked = rankRecommendations(items.filter((item) => !hidden.has(item.canonicalId ?? item.id)), { style: input.style, sortMode: input.sort, selectedDocuments: input.papers.map(recommendationDocument) });
      return input.sort === "retrieved_at" ? ranked : personalizeRecommendationOrder(ranked, input.profile);
    };
    if (!input.enabled) { update({ items: [], pending: false, status: "disabled", message: "联网推荐已关闭。" }); return () => abort.abort(); }
    if (!queries.length) { update({ items: [], pending: false, status: "idle", message: "勾选论文或在个人中心填写研究兴趣；开启本机画像后也可根据阅读记录推荐。" }); return () => abort.abort(); }
    const cache = read<{ key: string; items: RecommendationItem[] }[]>(cacheKey, []);
    const cacheId = JSON.stringify(["bibliographic-v3", input.config, queries, input.style]);
    const rawCached = cache.find((entry) => entry?.key === cacheId)?.items;
    const cached = Array.isArray(rawCached) ? rawCached.filter((item) => hasReadableRecommendationMetadata(item) && item && typeof item.id === "string" && typeof item.title === "string" && typeof item.relevanceScore === "number") : [];
    update({ items: filter(cached), pending: true, status: cached.length ? "ready" : "loading", message: cached.length ? "已显示本机缓存，正在更新…" : "正在直连文献 API…" });
    const timer = setTimeout(() => { void (async () => {
      try {
        if (!input.config) throw new Error("请在设置 → 文献服务选择自备 API，并填写地址与密钥。云端元信息不适用于本地文献模式。");
        if (navigator.onLine === false) throw new Error("当前没有网络连接");
        const items = await fetchLocalRecommendations(input.config, queries, input.style, abort.signal);
        if (!active()) return;
        let notice = "";
        try { localStorage.setItem(cacheKey, JSON.stringify([{ key: cacheId, items }, ...cache.filter((entry) => entry?.key !== cacheId)].slice(0, 8))); }
        catch { notice = "本机缓存保存失败，请检查存储空间。"; }
        update({ items: filter(items), status: "ready", message: `已获取 ${items.length} 条推荐。${notice}` });
      } catch (failure) { update({ items: filter(cached), status: cached.length ? "ready" : "error", message: `${cached.length ? "已保留本机缓存；" : ""}${String(failure)}` }); }
      finally { update({ pending: false }); }
    })(); }, 350);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [signature, refresh]);
  const current = state.signature === signature ? state : { items: [], status: "idle" as const, pending: false, message: "" };
  return { recommendationItems: current.items, recommendationStatus: current.status, recommendationPending: current.pending, recommendationMessage: current.message,
    refreshRecommendations: () => setRefresh((value) => value + 1),
    clearRecommendationCache: async () => { controller.current?.abort(); localStorage.removeItem(cacheKey); setState({ signature, items: [], pending: false, status: "idle", message: "已清除本机推荐缓存。" }); },
    recordRecommendationFeedback: async (candidate: RecommendationItem, _action: "saved" | "dismissed") => {
      const ids = read<string[]>(feedbackKey, []); const id = candidate.canonicalId ?? candidate.id;
      try { localStorage.setItem(feedbackKey, JSON.stringify([...ids.filter((value) => value !== id), id].slice(-500))); }
      catch { setState((current) => ({ ...current, message: "推荐反馈保存失败，请检查存储空间。" })); return false; }
      setState((current) => ({ ...current, items: current.items.filter((item) => (item.canonicalId ?? item.id) !== id), message: "反馈已保存到本机。" }));
      return true;
    },
  };
}
