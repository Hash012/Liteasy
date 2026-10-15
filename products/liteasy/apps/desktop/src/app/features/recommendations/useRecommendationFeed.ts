import { getActiveModelProvider, getModelForSettings } from "../models/modelPolicy";
import { curateRecommendationSnapshot } from "./recommendationResearchEnhancer";
import { enrichRecommendationCandidates } from "./recommendationPaperEvidence";
import { feedbackForPaper, feedbackFacet, type FeedbackRequest } from "./recommendationFeedbackProjection";
import { buildSelectionCacheKey, buildWorkspaceCacheKey } from "./useRecommendations";
import { adoptRecommendationBrief } from "./recommendationBrief";
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
  const contextVersion = feedHash([input.context.views.map(view => [view.id, view.revision]), input.profile, input.modelSettings ? [getActiveModelProvider(input.modelSettings), getModelForSettings(input.modelSettings), input.modelSettings["models.connection_mode"]] : null]);
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
  const [runState, setRunState] = useState({ identity, active: false });
  const running = runState.identity === identity && runState.active;
  const operation = useRef<{ identity: string; token: symbol }>();
  const begin = () => {
    if (operation.current?.identity === identity) return undefined;
    const token = Symbol("recommendation-operation");
    operation.current = { identity, token }; setRunState({ identity, active: true });
    return token;
  };
  const finish = (token: symbol) => {
    if (operation.current?.token !== token) return;
    operation.current = undefined;
    if (mounted.current && identityRef.current === identity) { setRunState({ identity, active: false }); setPhase(undefined); }
  };
  const [phase, setPhase] = useState<{ identity: string; message: string }>();
  const reportProgress = (message: string) => { if (mounted.current && identityRef.current === identity) setPhase({ identity, message }); };
  const evidenceEpoch = useRef<{ identity: string; epoch: number }>();
  const read = async () => { try { let value = await coordinator.read(); if (!latest.current.pending && value.current && value.current.sourceRevision !== latestContextVersion.current) value = await coordinator.invalidateEvidence(); if (mounted.current && identityRef.current === identity) setState({ identity, value }); } catch (error) { if (mounted.current && identityRef.current === identity) setState({ identity, error: String(error) }); } };
  const prepareContext = async (task: RecommendationTask) => {
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
    return { version, current, context, preferences, evidenceStore, evidence, projected };
  };
  const run = async (task: RecommendationTask) => {
    reportProgress("正在检索相关论文…");
    const { version, current, context, preferences, evidenceStore, evidence, projected } = await prepareContext(task);
    const documents = context.documents.filter(doc => preferences.sendPrivateText || !context.views.find(view => view.id === doc.id || view.id === `paper:${doc.id}`)?.private);
    const profile = preferences.sendPrivateText && preferences.useProfile ? current.profile : undefined;
    let items: RecommendationItem[];
    if (navigator.onLine === false) throw new Error("当前离线，显示本机缓存。");
    if (current.direct) {
      const derived = preferences.privacy.externalDerivedQueries ? evidence.facets.filter(facet => facet.status !== "paused").map(facet => facet.label).slice(0, 6) : [];
      const queries = derived.length ? [...derived, ...documents].slice(0, 6) : documents.length ? documents : [...(profile?.topics ?? []), ...(profile?.methods ?? [])].slice(0, 6);
      if (!queries.length) throw new Error("请先选中一篇论文并选择“按此选集探索”，或在推荐设置中添加研究主题。");
      if (!current.config) throw new Error("请在设置中配置文献服务。");
      items = await fetchLocalRecommendations(current.config, queries, current.style, task.signal, { citations: preferences.hybridEnabled, task, onSourceFailure: () => reportProgress("所选文献服务暂不可用，正在改用公开来源检索…") });
    } else {
      if (!current.accountSession) throw new Error("请登录后检查新论文。");
      if (!documents.length && !profile?.topics?.length && !profile?.methods?.length) throw new Error("请先选中一篇论文并选择“按此选集探索”，或在推荐设置中添加研究主题。");
      task.upstreamUnknown();
      try {
        items = await task.request("provider", () => (current.generator?.fetch ?? (request => fetchCloudRecommendations(request, { transport: current.transport })))({
          controlPlaneEndpoint: current.endpoint, sessionId: current.accountSession!.sessionId, selectedDocuments: documents.slice(0, 3), researchProfile: profile, style: current.style, sortMode: "relevance", signal: task.signal }));
      } catch (error) {
        task.signal.throwIfAborted();
        // A cloud outage must not force account setup for public bibliographic discovery.
        // Private notes/profile text are never redirected to a public registry.
        const publicDocuments = documents.filter(doc => context.views.some(view => (view.id === doc.id || view.id === `paper:${doc.id}`) && !view.private && view.provenance === "metadata"));
        if (!publicDocuments.length) throw error;
        reportProgress("推荐服务暂不可用，正在通过公开文献信息检索…");
        items = await fetchLocalRecommendations({ provider: "crossref", endpoint: "https://api.crossref.org" }, publicDocuments.slice(0, 3), current.style, task.signal, { task });
      }
    }
    if (!await task.active() || (await evidenceStore.read()).revision !== evidence.revision) throw new DOMException("Task evidence changed", "AbortError");
    items = rankRecommendations(items.slice(0, 200), { style: current.style, sortMode: "relevance", selectedDocuments: context.documents });
    if ((preferences.hybridEnabled || projected.length || evidence.facets.length) && context.views.length) {
      items = (await rankContextRecommendations({ assets: current.assets, items, context, preferences, scope: owner, workspace: current.workspace, style: current.style, signal: task.signal,
        active: () => !task.signal.aborted && identityRef.current === identity, task })).items;
    }
    if (version !== latestContextVersion.current || (await evidenceStore.read()).revision !== evidence.revision) throw new DOMException("Task evidence changed", "AbortError");
    const projection = (await coordinator.read()).feedbackProjection ?? [];
    items = items.map(item => {
      const related = item.contextEvidence?.find(row => context.views.some(view => view.id === row.viewId));
      const facetId = item.facetId ?? related?.viewId ?? `workspace:${feedHash(current.workspace)}`;
      const candidate = { ...item, facetId };
      return { ...candidate, preferencePenalty: feedbackForPaper(projection, candidate).some(row => row.dimension === "difficulty") ? .12 : 0 };
    });
    return rankRecommendations(items, { style: current.style });
  };
  const curate = async (only?: RecommendationItem) => {
    if (running || latest.current.pending) return;
    const token = begin();
    if (!token) return;
    setState(current => ({ ...current, error: undefined }));
    try {
      if (!latest.current.enabled) throw new Error("请在推荐设置中开启联网推荐。");
      if (!latest.current.preferences.generationEnabled) throw new Error("请在“推荐与文献服务设置”中开启 AI 研究建议；精选将使用当前对话模型。");
      if (!latest.current.modelSettings) throw new Error("请先在设置的“AI 接入”中配置可用模型。");
      let before = await coordinator.read();
      if (!before.current?.items.length && !only) {
        await coordinator.refresh("manual_check", run);
        before = await coordinator.read();
        await read();
      }
      const snapshot = before.current;
      if (!snapshot?.items.length) throw new Error(before.message || "没有找到相关论文。请选择有摘要的论文，或补充研究主题后再试。");
      await coordinator.refresh(only ? "explain" : "ai_curate", async task => {
        const { version, current, context, preferences, evidenceStore, evidence } = await prepareContext(task);
        const modelSnapshot = JSON.stringify(current.modelSettings);
        const active = async () => await task.active() && identityRef.current === identity && version === latestContextVersion.current
          && JSON.stringify(latest.current.modelSettings) === modelSnapshot && latest.current.preferences.consentEpoch === preferences.consentEpoch
          && (await coordinator.read()).feedbackRevision === before.feedbackRevision && (await evidenceStore.read()).revision === evidence.revision;
        const selected = only ? snapshot.items.filter(row => row.id === only.id) : rankRecommendations(snapshot.items.filter(row => !isRecommendationHidden(row, before)).map(item => ({ ...item, preferencePenalty: feedbackForPaper(before.feedbackProjection ?? [], item).some(row => row.dimension === "difficulty") ? .12 : 0 })), { style: current.style });
        reportProgress(`正在获取 ${Math.min(selected.length, 24)} 篇候选的摘要与 Introduction…`);
        const enriched = await enrichRecommendationCandidates(current.config, selected, task.signal, { ...task, active });
        if (!await active()) throw new Error("研究依据已变化，请重新精选。");
        reportProgress("AI 正在阅读摘要与 Introduction，并整理推荐理由…");
        const result = await curateRecommendationSnapshot({ assets: current.assets, items: enriched, context, preferences, settings: current.modelSettings, task: { ...task, active }, mode: only ? "explain" : "curate", feedbackRevision: before.feedbackRevision, snapshotId: snapshot.id });
        if (!await active()) throw new Error("研究依据已变化，请重新精选。");
        if (!result.items.length) throw new Error("本次没有足够相关的候选，保留原推荐。");
        return only ? snapshot.items.map(item => result.items.find(row => row.id === item.id) ?? item) : result.items;
      });
      await read();
    } catch (error) { if (mounted.current && identityRef.current === identity) setState(state => ({ ...state, identity, error: error instanceof Error ? error.message : "AI 精选暂不可用。" })); }
    finally { finish(token); }
  };
  const refresh = async (reason: "initial" | "manual_check" | "scheduled" | "explicit_seed") => {
    if (!latest.current.enabled || latest.current.pending) return;
    const token = begin();
    if (!token) return;
    if (mounted.current) setState(current => ({ ...current, error: undefined }));
    try {
      if (!(await coordinator.read()).current) {
        let legacy: RecommendationItem[] = [];
        if (input.direct) {
          try { const rows = JSON.parse(localStorage.getItem(`liteasy.local-recommendations.v1:${localAccount}:${input.workspace}`) || "[]"); if (Array.isArray(rows)) legacy = rows.flatMap(row => Array.isArray(row.items) ? row.items : []).slice(0, 200); } catch { /* Invalid legacy cache is not migrated. */ }
        } else if (input.legacyCache && input.accountSession) {
          try { const cached = await input.legacyCache.get({ sessionId: input.accountSession.sessionId, selectionKey: buildSelectionCacheKey(input.context.documents, undefined, input.style), workspaceKey: buildWorkspaceCacheKey(input.workspace), sortMode: "relevance", personalizationVersion: 0 }); if (cached.cacheHit) legacy = cached.recommendations; } catch { /* Discovery can still proceed. */ }
        }
        const publicLegacy = legacy.filter(item => item && typeof item.id === "string" && typeof item.title === "string" && Number.isFinite(item.relevanceScore) && !item.resourcePath && /^(crossref|openalex|semantic-scholar)$/i.test(item.source))
          .map(item => ({ ...item, reason: "", reasonState: "legacy" as const, researchReason: undefined, contextEvidence: undefined, keywordScores: undefined, relatedDocumentTitle: "", relatedDocumentTitles: undefined }));
        await coordinator.seedLegacy(publicLegacy);
      }
      await coordinator.refresh(reason, run); await read();
    }
    catch (error) { if (mounted.current && identityRef.current === identity) setState(current => ({ ...current, identity, error: String(error) })); }
    finally { finish(token); }
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
  useEffect(() => () => coordinator.cancel(), [identity]);
  const error = state.identity === identity ? state.error : undefined;
  const value = state.identity === identity && input.enabled ? state.value : undefined;
  const items = useMemo(() => (value?.current?.selection === "ai" ? (rows: RecommendationItem[]) => rows : rankRecommendations)(value?.current?.items.filter(item => !isRecommendationHidden(item, value)).map(item => ({ ...item, feedSnapshotId: value.current!.id, feedbackState: feedbackForPaper(value.feedbackProjection ?? [], item), ...(value.saved.includes(item.canonicalId ?? item.id) ? { saved: true } : {}) })) ?? [], { style: input.style, sortMode: input.sort ?? "relevance" }), [value?.current?.id, value?.hidden.join("|"), value?.saved.join("|"), JSON.stringify(value?.feedback), identity, input.style, input.sort]);
  return { recommendationItems: items, recommendationStatus: (!input.enabled ? "disabled" : running && !items.length ? "loading" : value?.current ? "ready" : error ? "error" : "idle") as RecommendationStatus,
    recommendationPending: running, recommendationMessage: (running && phase?.identity === identity ? phase.message : undefined) ?? error ?? value?.message ?? (value?.current && navigator.onLine === false ? "当前离线，显示本机缓存。" : value?.current ? value.current.selection === "ai" ? `AI 已精选 ${items.length} 篇 · 已阅读 ${value.current.items[0]?.researchReason?.evaluatedCount ?? items.length} 篇候选的可用摘要与引言` : value.current.generatedAt ? `上次更新：${new Date(value.current.generatedAt).toLocaleString()}` : "旧版题录缓存 · 待更新" : "根据资料库和研究兴趣提供推荐；也可明确按选集探索。"),
    recordSignal: async (item: RecommendationItem, action: RecommendationFeedbackMeaning, command?: FeedbackRequest) => { const receipt = await coordinator.recordFeedback(item.canonicalId ?? item.id, action, item.feedSnapshotId, feedbackFacet(item), command); await read(); return receipt; },
    adoptBrief: async (item: RecommendationItem) => { if (!latest.current.assets) throw new Error("当前工作区不能保存笔记。"); return adoptRecommendationBrief(item, latest.current.assets, async source => {
      const controller = new AbortController();
      const frozen = await prepareContext({ signal: controller.signal, active: async () => true, request: async () => { throw new Error("采用笔记不会调用模型。"); }, upstreamUnknown() {} });
      return frozen.context.views.some(view => view.id === source.evidenceId && view.revision === source.revision && view.text.startsWith(source.text));
    }); },
    pendingSnapshot: Boolean(value?.pending), acceptPending: async () => { await coordinator.acceptPending(); await read(); },
    curateRecommendations: curate, restoreRecommendations: async () => { await coordinator.restorePrevious(); await read(); }, hasPreviousRecommendations: Boolean(value?.previous),
    applyLocalPreferences: async () => { await coordinator.applyPreferences(); await read(); },
    refreshRecommendations: () => refresh("manual_check"),
    clearRecommendationCache: async () => { await coordinator.clear(); await read(); },
    recordRecommendationFeedback: async (candidate: RecommendationItem, action: "saved" | "dismissed") => {
      if (action === "dismissed") await coordinator.recordFeedback(candidate.canonicalId ?? candidate.id, "not_relevant", candidate.feedSnapshotId, feedbackFacet(candidate));
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
