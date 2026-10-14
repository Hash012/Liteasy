import { buildSelectionCacheKey, buildWorkspaceCacheKey } from "./useRecommendations";
import { adoptRecommendationBrief } from "./recommendationBrief";
import { enhanceRecommendationReasons } from "./recommendationResearchEnhancer";
import type { SettingsState } from "../settings/settings.types";
import { createRecommendationEvidenceStore } from "./recommendationEvidence";
import { projectEvidence } from "../../../../../../packages/recommendation-core/v2.mjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { createObjectStorage, subscribeObjectStorage } from "../objects/objectStorage";
import { resolveLocalAccountKey } from "../library/localAccountKey";
import { RecommendationFeedCoordinator, feedHash, isRecommendationHidden, recommendationStatePrefix, type FeedState, type RecommendationTask, type RecommendationFeedbackMeaning } from "./recommendationCoordinator";
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
export type FeedInput = { modelSettings?: SettingsState; enabled: boolean; direct: boolean; accountSession: AccountSession | null; endpoint: string; scope: string; workspace: string;
  context: RecommendationContext; pending: boolean; preferences: RecommendationPreferences; profile?: RecommendationResearchProfile; style: RecommendationStyle; sort?: "relevance" | "retrieved_at";
  config?: PaperServiceConfig; assets?: AgentAssetService; transport?: RecommendationTransport; feedbackTransport?: RecommendationFeedbackTransport;
  generator?: { fetch: (input: RecommendationRuntimeInput) => Promise<RecommendationItem[]> }; seedId?: string;
  legacyCache?: { get: (scope: RecommendationCacheScope) => Promise<{ cacheHit: boolean; recommendations: RecommendationItem[] }> };
};
/** React subscribes to the durable feed. Changing context only updates the next task's input. */
export function useRecommendationFeed(input: FeedInput) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const latest = useRef(input); latest.current = input;
  const contextVersion = feedHash([input.context.views.map(view => [view.id, view.revision]), input.profile]);
  const latestContextVersion = useRef(contextVersion); latestContextVersion.current = contextVersion;
  const previousContext = useRef<{ identity: string; version: string }>();
  const localAccount = resolveLocalAccountKey();
  const owner = input.scope === "local" && localAccount !== "guest" ? localAccount : input.scope;
  const policy = feedHash([input.enabled, input.direct, input.config, input.endpoint, [input.accountSession?.userId ?? input.accountSession?.email, input.accountSession?.issuer, input.accountSession?.membershipTier], input.preferences.consentEpoch, input.preferences.generationEnabled, input.preferences.sendPrivateText, input.preferences.useAnnotations, input.preferences.useProfile, input.preferences.hybridEnabled, input.preferences.embedding, input.preferences.reranker]);
  const identity = feedHash([owner, input.workspace, policy, input.seedId ?? "ordinary"]);
  const identityRef = useRef(identity); identityRef.current = identity;
  const currentOwner = useRef(owner); currentOwner.current = owner;
  const coordinator = useMemo(() => new RecommendationFeedCoordinator({ storage: createObjectStorage(owner, () => currentOwner.current), scope: owner, key: identity, workspaceId: input.workspace, sourceRevision: () => latestContextVersion.current,
    provider: feedHash([input.direct ? input.config : input.endpoint, input.accountSession?.userId ?? input.accountSession?.email ?? localAccount]), automaticHours: () => latest.current.preferences.feed.automaticHours, unreadCap: () => latest.current.preferences.feed.unreadCap }), [identity]);
  const [state, setState] = useState<{ identity: string; value?: FeedState; error?: string }>({ identity });
  const [running, setRunning] = useState(false);
  const evidenceEpoch = useRef<{ identity: string; epoch: number }>();
  const read = async () => { try { let value = await coordinator.read(); if (!latest.current.pending && value.current && value.current.sourceRevision !== latestContextVersion.current) value = await coordinator.invalidateEvidence(); if (mounted.current && identityRef.current === identity) setState({ identity, value }); } catch (error) { if (mounted.current && identityRef.current === identity) setState({ identity, error: String(error) }); } };
  const run = async (task: RecommendationTask) => {
    // Snapshot the authorized input once. No closure reads after a request starts.
    const version = latestContextVersion.current;
    const current = latest.current, context = structuredClone(current.context), preferences = structuredClone(current.preferences);
    const evidenceStore = createRecommendationEvidenceStore(owner, () => currentOwner.current);
    const evidence = await evidenceStore.read();
    context.views = context.views.filter(view => !evidence.tombstones.includes(view.id));
    const excluded = new Set([...(evidence.suppressedEvidence ?? []), ...evidence.facets.filter(facet => facet.status === "paused").flatMap(facet => [...facet.evidenceIds])]);
    const excludedSources = new Set(evidence.events.filter(event => excluded.has(event.id)).map(event => event.sourceId));
    context.views = context.views.filter(view => !excludedSources.has(view.id));
    context.documents = context.documents.filter(doc => !excludedSources.has(`paper:${doc.id}`));
    const projected = projectEvidence(evidence.events, { now: Date.now(), epoch: preferences.consentEpoch, tombstones: evidence.tombstones }).filter(event => !excluded.has(event.id));
    const liveIds = new Set(context.documents.map(doc => `paper:${doc.id}`));
    const liveAnnotations = new Set(context.views.map(view => view.id));
    const evidenceStorage = createObjectStorage(owner, () => currentOwner.current);
    for (const event of projected) {
      if (event.type === "user_question_committed" && !await evidenceStorage.get(`assistant/v2/message/${encodeURIComponent(event.sourceId.slice(5))}/${encodeURIComponent(event.revision)}`)) continue;
      if (evidence.facets.some(facet => facet.status === "paused" && facet.evidenceIds.includes(event.id))) continue;
      if (event.type === "qualified_reading_interval" && !liveIds.has(event.sourceId) || event.type === "annotation_committed" && !liveAnnotations.has(event.sourceId)) continue;
      context.views.push({ id: event.id, title: event.text.slice(0, 80), text: event.text, revision: event.revision, private: true, kind: "profile", provenance: "profile", importance: event.weight });
    }
    for (const facet of evidence.facets.filter(facet => ["confirmed", "pinned"].includes(facet.status))) {
      context.views.push({ id: facet.id, title: facet.label, text: facet.problem, revision: facet.version, private: true, kind: "profile", provenance: "profile", importance: 1 });
    }
    const documents = context.documents.filter(doc => preferences.sendPrivateText || !context.views.find(view => view.id === doc.id)?.private);
    const profile = preferences.sendPrivateText && preferences.useProfile ? current.profile : undefined;
    let items: RecommendationItem[];
    if (navigator.onLine === false) throw new Error("当前离线，显示本机缓存。");
    if (current.direct) {
      const derived = preferences.privacy.externalDerivedQueries ? evidence.facets.filter(facet => facet.status !== "paused").map(facet => facet.label).slice(0, 6) : [];
      const queries = derived.length ? [...derived, ...documents].slice(0, 6) : documents.length ? documents : [...(profile?.topics ?? []), ...(profile?.methods ?? [])].slice(0, 6);
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
    if (!await task.active() || (await evidenceStore.read()).revision !== evidence.revision) throw new DOMException("Task evidence changed", "AbortError");
    items = rankRecommendations(items.slice(0, 200), { style: current.style, sortMode: "relevance", selectedDocuments: context.documents });
    if ((preferences.hybridEnabled || projected.length || evidence.facets.length) && context.views.length) {
      items = (await rankContextRecommendations({ assets: current.assets, items, context, preferences, scope: owner, workspace: current.workspace, style: current.style, signal: task.signal,
        active: () => !task.signal.aborted && identityRef.current === identity, task })).items;
    }
    if (version !== latestContextVersion.current || (await evidenceStore.read()).revision !== evidence.revision) throw new DOMException("Task evidence changed", "AbortError");
    const feedback = (await coordinator.read()).feedback ?? [];
    items = items.map(item => feedback.some(row => row.id === (item.canonicalId ?? item.id) && (!row.facetId || row.facetId === item.relatedDocumentTitle) && ["too_basic", "too_advanced"].includes(row.action))
      ? { ...item, scoreComponents: { ...item.scoreComponents, baseRelevance: item.relevanceScore, diversityPenalty: item.scoreComponents?.diversityPenalty ?? 0, preference: item.scoreComponents?.preference ?? 0, sourceRelevance: item.relevanceScore,
        finalScore: Math.max(0, (item.scoreComponents?.finalScore ?? item.relevanceScore) - .12) } } : item);
    const enhanced = await enhanceRecommendationReasons({ assets: current.assets, items, context, preferences, settings: current.modelSettings, task });
    if (version !== latestContextVersion.current || (await evidenceStore.read()).revision !== evidence.revision) throw new DOMException("Task evidence changed", "AbortError");
    return enhanced;
  };
  const refresh = async (reason: "initial" | "manual_check" | "scheduled" | "explicit_seed") => {
    if (!latest.current.enabled || latest.current.pending) return;
    if (mounted.current) setRunning(true);
    try {
      if (!(await coordinator.read()).current) {
        let legacy: RecommendationItem[] = [];
        if (input.direct) {
          try { const rows = JSON.parse(localStorage.getItem(`liteasy.local-recommendations.v1:${localAccount}:${input.workspace}`) || "[]"); if (Array.isArray(rows)) legacy = rows.flatMap(row => Array.isArray(row.items) ? row.items : []).slice(0, 200); } catch { /* Invalid legacy cache is not migrated. */ }
        } else if (input.legacyCache && input.accountSession) {
          try { const cached = await input.legacyCache.get({ sessionId: input.accountSession.sessionId, selectionKey: buildSelectionCacheKey(input.context.documents, undefined, input.style), workspaceKey: buildWorkspaceCacheKey(input.workspace), sortMode: "relevance", personalizationVersion: 0 }); if (cached.cacheHit) legacy = cached.recommendations; } catch { /* Discovery can still proceed. */ }
        }
        const publicLegacy = legacy.filter(item => item && typeof item.id === "string" && typeof item.title === "string" && Number.isFinite(item.relevanceScore) && !item.resourcePath && /^(crossref|openalex|semantic-scholar)$/i.test(item.source))
          .map(item => ({ ...item, reason: "来自旧版题录缓存，尚未结合当前研究问题更新。", researchReason: undefined, contextEvidence: undefined, keywordScores: undefined, relatedDocumentTitle: "", relatedDocumentTitles: undefined }));
        await coordinator.seedLegacy(publicLegacy);
      }
      await coordinator.refresh(reason, run); await read();
    }
    catch (error) { if (mounted.current && identityRef.current === identity) setState(current => ({ ...current, identity, error: String(error) })); }
    finally { if (mounted.current && identityRef.current === identity) setRunning(false); }
  };
  useEffect(() => {
    let alive = true;
    const reload = () => { if (alive) void (async () => {
      const evidence = await createRecommendationEvidenceStore(owner, () => currentOwner.current).read();
      const previous = evidenceEpoch.current;
      evidenceEpoch.current = { identity, epoch: evidence.epoch };
      if (previous?.identity === identity && previous.epoch !== evidence.epoch) {
        setState({ identity }); await coordinator.clear();
      }
      if (alive) await read();
    })().catch(() => {}); };
    const unsubscribe = subscribeObjectStorage(owner, keys => { if (keys?.some(key => key.startsWith(recommendationStatePrefix))) reload(); });
    // Native storage is shared across windows; polling also observes crash recovery and remote publishes.
    const interval = setInterval(reload, 2000); reload();
    return () => { alive = false; unsubscribe(); clearInterval(interval); };
  }, [identity]);
  useEffect(() => {
    if (input.enabled && !input.pending) void refresh(input.seedId ? "explicit_seed" : "initial");
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh("scheduled"); }, 60_000);
    return () => clearInterval(timer);
  }, [identity, input.enabled, input.pending]);
  useEffect(() => {
    if (input.pending) return;
    const previous = previousContext.current; previousContext.current = { identity, version: contextVersion };
    if (previous?.identity === identity && previous.version !== contextVersion) void coordinator.invalidateEvidence().then(read).catch(() => {});
  }, [identity, contextVersion, input.pending]);
  useEffect(() => () => { if (identityRef.current !== identity) coordinator.cancel(); }, [identity]);
  const value = state.identity === identity && input.enabled ? state.value : undefined;
  const items = useMemo(() => rankRecommendations(value?.current?.items.filter(item => !isRecommendationHidden(item, value)).map(item => ({ ...item, feedSnapshotId: value.current!.id, ...(value.saved.includes(item.canonicalId ?? item.id) ? { saved: true } : {}) })) ?? [], { style: input.style, sortMode: input.sort ?? "relevance" }), [value?.current?.id, value?.hidden.join("|"), value?.saved.join("|"), JSON.stringify(value?.feedback), identity, input.style, input.sort]);
  return { recommendationItems: items, recommendationStatus: (!input.enabled ? "disabled" : running && !items.length ? "loading" : value?.current ? "ready" : state.error ? "error" : "idle") as RecommendationStatus,
    recommendationPending: running, recommendationMessage: value?.message ?? state.error ?? (value?.current && navigator.onLine === false ? "当前离线，显示本机缓存。" : value?.current ? value.current.generatedAt ? `上次更新：${new Date(value.current.generatedAt).toLocaleString()}` : "旧版题录缓存 · 待更新" : "根据资料库和研究兴趣提供推荐；也可明确按选集探索。"),
    recordSignal: async (item: RecommendationItem, action: RecommendationFeedbackMeaning) => { await coordinator.recordFeedback(item.canonicalId ?? item.id, action, item.feedSnapshotId, item.relatedDocumentTitle); await read(); },
    adoptBrief: async (item: RecommendationItem) => { if (!latest.current.assets) throw new Error("当前工作区不能保存笔记。"); return adoptRecommendationBrief(item, latest.current.assets); },
    pendingSnapshot: Boolean(value?.pending), acceptPending: async () => { await coordinator.acceptPending(); await read(); },
    refreshRecommendations: () => refresh("manual_check"),
    clearRecommendationCache: async () => { await coordinator.clear(); await read(); },
    recordRecommendationFeedback: async (candidate: RecommendationItem, action: "saved" | "dismissed") => {
      if (action === "dismissed") await coordinator.recordFeedback(candidate.canonicalId ?? candidate.id, "not_relevant", candidate.feedSnapshotId, candidate.relatedDocumentTitle);
      else await coordinator.feedback(candidate.canonicalId ?? candidate.id, action);
      await read();
      if (!input.direct && input.accountSession) {
        try { await createRecommendationFeedbackClient({ endpoint: input.endpoint, transport: input.feedbackTransport })({ sessionId: input.accountSession.sessionId, candidate, action }); }
        catch { /* Local suppression remains authoritative if cloud feedback is offline. */ }
      }
      return true;
    }
  };
}
