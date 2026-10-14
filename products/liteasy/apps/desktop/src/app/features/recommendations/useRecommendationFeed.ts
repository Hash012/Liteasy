import { useEffect, useMemo, useRef, useState } from "react";
import { createObjectStorage, subscribeObjectStorage } from "../objects/objectStorage";
import { resolveLocalAccountKey } from "../library/localAccountKey";
import { RecommendationFeedCoordinator, feedHash, recommendationStatePrefix, type FeedState, type RecommendationTask } from "./recommendationCoordinator";
import type { RecommendationContext } from "./recommendationContext";
import type { RecommendationPreferences } from "./recommendationPreferences";
import type { RecommendationItem, RecommendationResearchProfile, RecommendationStatus, RecommendationStyle } from "./recommendation.types";
import type { PaperServiceConfig } from "../paper-services/paperServiceTransport";
import type { AccountSession } from "../account/account.types";
import type { AgentAssetService } from "../resource-filesystem/agentAssetService";
import type { RecommendationRuntimeInput } from "./recommendationRuntime";
import type { RecommendationTransport } from "./recommendationClient";
import { fetchCloudRecommendations } from "./recommendationRuntime";
import { fetchLocalRecommendations } from "./localRecommendationClient";
import { rankRecommendations } from "./recommendationRanking";
import { rankContextRecommendations } from "./recommendationHybridPipeline";
import { createRecommendationFeedbackClient, type RecommendationFeedbackTransport } from "./recommendationFeedbackClient";
import type { RecommendationCacheScope } from "./recommendationCache.types";
export type FeedInput = { enabled: boolean; direct: boolean; accountSession: AccountSession | null; endpoint: string; scope: string; workspace: string;
  context: RecommendationContext; pending: boolean; preferences: RecommendationPreferences; profile?: RecommendationResearchProfile; style: RecommendationStyle;
  config?: PaperServiceConfig; assets?: AgentAssetService; transport?: RecommendationTransport; feedbackTransport?: RecommendationFeedbackTransport;
  generator?: { fetch: (input: RecommendationRuntimeInput) => Promise<RecommendationItem[]> }; seedId?: string;
  legacyCache?: { get: (scope: RecommendationCacheScope) => Promise<{ cacheHit: boolean; recommendations: RecommendationItem[] }> };
};
/** React subscribes to the durable feed. Changing context only updates the next task's input. */
export function useRecommendationFeed(input: FeedInput) {
  const latest = useRef(input); latest.current = input;
  const localAccount = resolveLocalAccountKey();
  const owner = input.scope === "local" && localAccount !== "guest" ? localAccount : input.scope;
  const policy = feedHash([input.enabled, input.direct, input.endpoint, input.accountSession?.sessionId, input.preferences.sendPrivateText, input.preferences.useAnnotations, input.preferences.useProfile, input.preferences.hybridEnabled, input.preferences.embedding, input.preferences.reranker]);
  const identity = feedHash([owner, input.workspace, policy, input.seedId ?? "ordinary"]);
  const identityRef = useRef(identity); identityRef.current = identity;
  const currentOwner = useRef(owner); currentOwner.current = owner;
  const coordinator = useMemo(() => new RecommendationFeedCoordinator({ storage: createObjectStorage(owner, () => currentOwner.current), scope: owner, key: identity,
    provider: feedHash([input.direct ? input.config : input.endpoint, input.accountSession?.userId ?? input.accountSession?.email ?? localAccount]) }), [identity]);
  const [state, setState] = useState<{ identity: string; value?: FeedState; error?: string }>({ identity });
  const [running, setRunning] = useState(false);
  const read = async () => { try { const value = await coordinator.read(); if (identityRef.current === identity) setState({ identity, value }); } catch (error) { if (identityRef.current === identity) setState({ identity, error: String(error) }); } };
  const run = async (task: RecommendationTask) => {
    // Snapshot the authorized input once. No closure reads after a request starts.
    const current = latest.current, context = structuredClone(current.context), preferences = structuredClone(current.preferences);
    const documents = context.documents.filter(doc => preferences.sendPrivateText || !context.views.find(view => view.id === doc.id)?.private);
    const profile = preferences.sendPrivateText && preferences.useProfile ? current.profile : undefined;
    let items: RecommendationItem[];
    if (current.direct) {
      const queries = documents.length ? documents : [...(profile?.topics ?? []), ...(profile?.methods ?? [])].slice(0, 6);
      if (!queries.length) return [];
      if (!current.config) throw new Error("请在设置中配置文献服务。");
      items = await fetchLocalRecommendations(current.config, queries, current.style, task.signal, { citations: preferences.hybridEnabled, task });
    } else {
      if (!current.accountSession) throw new Error("请登录后检查新论文。");
      if (!documents.length && !profile?.topics?.length && !profile?.methods?.length) return [];
      task.upstreamUnknown();
      items = await task.request("provider", () => (current.generator?.fetch ?? (request => fetchCloudRecommendations(request, { transport: current.transport })))({
        controlPlaneEndpoint: current.endpoint, sessionId: current.accountSession!.sessionId, selectedDocuments: documents.slice(0, 3), researchProfile: profile, style: current.style, sortMode: "relevance", signal: task.signal }));
    }
    if (!await task.active()) throw new DOMException("Task revoked", "AbortError");
    items = rankRecommendations(items.slice(0, 200), { style: current.style, sortMode: "relevance", selectedDocuments: context.documents });
    if (preferences.hybridEnabled && context.views.length) {
      items = (await rankContextRecommendations({ assets: current.assets, items, context, preferences, scope: owner, workspace: current.workspace, style: current.style, signal: task.signal,
        active: () => !task.signal.aborted && identityRef.current === identity, task })).items;
    }
    return items;
  };
  const refresh = async (reason: "initial" | "manual_check" | "scheduled" | "explicit_seed") => {
    if (!latest.current.enabled || latest.current.pending) return;
    setRunning(true);
    try { await coordinator.refresh(reason, run); await read(); }
    catch (error) { if (identityRef.current === identity) setState(current => ({ ...current, identity, error: String(error) })); }
    finally { if (identityRef.current === identity) setRunning(false); }
  };
  useEffect(() => {
    let alive = true;
    const reload = () => { if (alive) void read(); };
    const unsubscribe = subscribeObjectStorage(owner, keys => { if (keys?.some(key => key.startsWith(recommendationStatePrefix))) reload(); });
    // Native storage is shared across windows; polling also observes crash recovery and remote publishes.
    const interval = setInterval(reload, 2000); reload();
    return () => { alive = false; unsubscribe(); clearInterval(interval); };
  }, [identity]);
  useEffect(() => {
    if (input.enabled && !input.pending) void refresh("initial");
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh("scheduled"); }, 60_000);
    return () => clearInterval(timer);
  }, [identity, input.enabled, input.pending]);
  useEffect(() => () => { if (identityRef.current !== identity) coordinator.cancel(); }, [identity]);
  const value = state.identity === identity && input.enabled ? state.value : undefined;
  const items = useMemo(() => value?.current?.items.filter(item => !value.hidden.includes(item.canonicalId ?? item.id)).map(item => value.saved.includes(item.canonicalId ?? item.id) ? { ...item, saved: true } : item) ?? [], [value?.current?.id, value?.hidden.join("|"), value?.saved.join("|"), identity]);
  return { recommendationItems: items, recommendationStatus: (!input.enabled ? "disabled" : running && !items.length ? "loading" : items.length ? "ready" : state.error ? "error" : "idle") as RecommendationStatus,
    recommendationPending: running, recommendationMessage: value?.message ?? state.error ?? (value?.current ? `上次更新：${new Date(value.current.generatedAt).toLocaleString()}` : "根据资料库和研究兴趣提供推荐；也可明确按选集探索。"),
    pendingSnapshot: Boolean(value?.pending), acceptPending: async () => { await coordinator.acceptPending(); await read(); },
    refreshRecommendations: () => refresh("manual_check"),
    clearRecommendationCache: async () => { await coordinator.clear(); await read(); },
    recordRecommendationFeedback: async (candidate: RecommendationItem, action: "saved" | "dismissed") => {
      await coordinator.feedback(candidate.canonicalId ?? candidate.id, action); await read();
      if (!input.direct && input.accountSession) {
        try { await createRecommendationFeedbackClient({ endpoint: input.endpoint, transport: input.feedbackTransport })({ sessionId: input.accountSession.sessionId, candidate, action }); }
        catch { /* Local suppression remains authoritative if cloud feedback is offline. */ }
      }
      return true;
    }
  };
}
