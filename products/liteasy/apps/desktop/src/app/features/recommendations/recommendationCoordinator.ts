import { commitFeedback, emptyFeedback, projectFeedback, feedbackHides, type FeedbackCommand, type FeedbackState, type FeedbackReceipt, type FeedbackProjection, feedbackForPaper } from "./recommendationFeedbackProjection";
import type { ObjectStorage, StorageRow } from "../objects/objectStorage";
import type { RecommendationItem } from "./recommendation.types";
export const recommendationStatePrefix = "recommendation/v2/";
const DAY = 86_400_000;
export const feedHash = (value: unknown) => { const text = JSON.stringify(value); let hash = 2166136261; for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return (hash >>> 0).toString(16); };
export type FeedSnapshot = { id: string; generatedAt: number; expiresAt: number; items: RecommendationItem[]; sourceRevision?: string; recipe: "stable-feed-v2" };
type Lease = { id: string; root?: string; until: number };
export type RecommendationFeedbackMeaning = "read" | "not_relevant" | "too_basic" | "too_advanced" | "snoozed" | "undo";
export type FeedState = { feedbackRevision?: number; feedbackProjection?: FeedbackProjection[]; feedback?: { id: string; action: RecommendationFeedbackMeaning; at: number; snapshotId?: string; facetId?: string }[]; epoch: number; current?: FeedSnapshot; previous?: FeedSnapshot; pending?: FeedSnapshot; lease?: Lease; automaticRuns: number[]; hidden: string[]; saved: string[]; message?: string; usage?: Record<string, number | string> };
type Ledger = { entries: { at: number; kind: string; units: number }[]; active: { id: string; until: number; kind: string }[]; cooldown?: number };
export type RecommendationTask = { signal: AbortSignal; active: () => Promise<boolean>; request: <T>(kind: "provider" | "embedding" | "reranker" | "generation", run: () => Promise<T>, units?: number) => Promise<T>; upstreamUnknown: () => void };
const empty = (): FeedState => ({ epoch: 0, automaticRuns: [], hidden: [], saved: [] });
export function isRecommendationHidden(item: RecommendationItem, state: FeedState) {
  if (state.feedbackProjection) return feedbackHides(state.feedbackProjection, item);
  const id = item.canonicalId ?? item.id;
  return state.hidden.includes(id) || Boolean(state.feedback?.some(row => row.id === id && row.action === "not_relevant"
    && (!row.facetId || row.facetId === item.facetId)));
}
/** CAS is backed by the existing native SQLite IMMEDIATE transaction (IndexedDB in web tests).
 * Leases and reservations, rather than a process-local Map, arbitrate multiple windows. */
export async function updateRecommendationRow<T>(storage: ObjectStorage, key: string, initial: () => T, edit: (value: T) => T): Promise<T> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const row = await storage.get(key); const next = edit(structuredClone((row?.value as T) ?? initial()));
    const change: StorageRow = { key, version: crypto.randomUUID(), value: next };
    try { await storage.commit([{ key, expected: row?.version ?? null, row: change }]); return next; }
    catch (error) { if ((error as { code?: string }).code !== "revision_conflict" || attempt === 11) throw error; }
  }
  throw new Error("推荐状态繁忙，请稍后重试。");
}
export class RecommendationFeedCoordinator {
  private controller?: AbortController;
  private readonly key: string;
  private readonly ledgerKey: string;
  private readonly feedbackKey: string;
  constructor(private options: { storage: ObjectStorage; scope: string; key: string; workspaceId?: string; provider: string; now?: () => number; deadlineMs?: number; sourceRevision?: () => string; automaticHours?: number | (() => number); unreadCap?: number | (() => number) }) {
    this.feedbackKey = recommendationStatePrefix + "feedback/" + feedHash(options.workspaceId ?? "default");
    this.key = recommendationStatePrefix + "feed/" + options.key;
    // The account-wide cap is deliberately stricter than per-workspace/provider limits.
    this.ledgerKey = recommendationStatePrefix + "budget/providers";
  }
  private now() { return (this.options.now ?? Date.now)(); }
  private automaticHours() { return typeof this.options.automaticHours === "function" ? this.options.automaticHours() : this.options.automaticHours ?? 24; }
  private unreadCap() { return typeof this.options.unreadCap === "function" ? this.options.unreadCap() : this.options.unreadCap ?? 9; }
  private async preferences(): Promise<FeedbackState> {
    const existing = (await this.options.storage.get(this.feedbackKey))?.value as FeedbackState | undefined;
    if (existing?.migrations.includes(this.key)) return existing;
    const legacy = (await this.options.storage.get(this.key))?.value as FeedState | undefined;
    return updateRecommendationRow(this.options.storage, this.feedbackKey, emptyFeedback, value => {
      if (value.migrations.includes(this.key)) return value;
      const rows = legacy?.feedback ?? [];
      const prior = [...value.base, ...value.events.map(row => ({ ...row, dimension: ["too_basic", "too_advanced"].includes(row.action) ? "difficulty" : row.action }))];
      const existed = (id: string, action: string) => prior.some(row => row.paperId === id && row.dimension === (["too_basic", "too_advanced"].includes(action) ? "difficulty" : action));
      for (const row of rows.filter(row => row.action !== "undo" && !existed(row.id, row.action))) value.base.push({ paperId: row.id, facetId: ["read"].includes(row.action) ? undefined : "legacy-unscoped", dimension: ["too_basic", "too_advanced"].includes(row.action) ? "difficulty" : row.action, action: row.action, at: row.at, eventId: `legacy:${this.key}:${row.id}:${row.action}` });
      for (const id of legacy?.hidden ?? []) if (!existed(id, "legacy_suppression") && !rows.some(row => row.id === id && ["read", "snoozed", "undo"].includes(row.action))) value.base.push({ paperId: id, dimension: "legacy_suppression", action: "legacy_suppression", at: this.now(), eventId: `legacy:${this.key}:${id}` });
      for (const id of legacy?.saved ?? []) if (!existed(id, "saved")) value.base.push({ paperId: id, dimension: "saved", action: "saved", at: this.now(), eventId: `legacy:${this.key}:${id}:saved` });
      value.migrations.push(this.key);
      return value;
    });
  }
  async read(): Promise<FeedState> {
    const value = (await this.options.storage.get(this.key))?.value as FeedState ?? empty();
    const preferences = await this.preferences(), projection = projectFeedback(preferences, this.now());
    return { ...value, feedbackRevision: preferences.revision, feedbackProjection: projection,
      hidden: projection.filter(row => !row.facetId && ["read", "legacy_suppression"].includes(row.action)).map(row => row.paperId),
      saved: projection.filter(row => row.action === "saved").map(row => row.paperId),
      feedback: projection.filter(row => !["saved", "legacy_suppression"].includes(row.action)).map(row => ({ id: row.paperId, action: row.action as RecommendationFeedbackMeaning, at: row.at, facetId: row.facetId })) };
  }
  async executeFeedback(command: FeedbackCommand): Promise<FeedbackReceipt> {
    await this.preferences();
    const value = await updateRecommendationRow(this.options.storage, this.feedbackKey, emptyFeedback, value => { commitFeedback(value, command, this.now()); return value; });
    return value.receipts.find(row => row.commandId === command.commandId)!;
  }
  private edit(fn: (value: FeedState) => FeedState) { return updateRecommendationRow(this.options.storage, this.key, empty, fn); }
  async clear() { this.controller?.abort(); return this.edit(value => ({ ...empty(), epoch: value.epoch + 1, hidden: value.hidden, saved: value.saved, feedback: value.feedback, automaticRuns: value.automaticRuns.length ? value.automaticRuns : [this.now()] })); }
  async invalidateEvidence() {
    this.controller?.abort();
    return this.edit(value => ({ ...value, epoch: value.epoch + 1, lease: undefined, pending: undefined,
      current: value.current ? { ...value.current, id: crypto.randomUUID(), sourceRevision: this.options.sourceRevision?.(), items: value.current.items.filter(item => !item.resourcePath && !item.contextEvidence?.length && !item.researchReason) } : undefined }));
  }
  cancel() { this.controller?.abort(); }
  async acceptPending() { return this.edit(value => value.pending ? { ...value, current: value.pending, pending: undefined } : value); }
  async feedback(id: string, action: "saved" | "dismissed") {
    await this.executeFeedback({ commandId: crypto.randomUUID(), issuedAt: this.now() || 1, paperId: id, action: action === "saved" ? "saved" : "legacy_suppression" });
    return this.read();
  }
  async recordFeedback(id: string, action: RecommendationFeedbackMeaning, snapshotId?: string, facetId?: string, command?: { commandId: string; issuedAt: number; targetEventId?: string }) {
    return this.executeFeedback({ commandId: command?.commandId ?? crypto.randomUUID(), issuedAt: command?.issuedAt ?? (this.now() || 1), paperId: id, action, snapshotId, facetId, targetEventId: command?.targetEventId });
  }
  async restorePrevious() { return this.edit(value => value.previous ? { ...value, current: value.previous, previous: undefined } : value); }
  async applyPreferences() {
    const preferences = await this.preferences(), projection = projectFeedback(preferences, this.now());
    return this.edit(value => ({ ...value, current: value.current ? { ...value.current, id: crypto.randomUUID(), items: value.current.items.map(item => ({ ...item, preferencePenalty: feedbackForPaper(projection, item).some(row => row.dimension === "difficulty") ? .12 : 0 })) } : undefined }));
  }
  async seedLegacy(items: RecommendationItem[]) {
    if (!items.length) return;
    await this.edit(value => value.current || value.lease ? value : { ...value, current: { id: crypto.randomUUID(), generatedAt: 0, expiresAt: 0, sourceRevision: this.options.sourceRevision?.(), recipe: "stable-feed-v2", items: items.slice(0, 200) } });
  }
  async refresh(reason: "initial" | "scheduled" | "manual_check" | "explicit_seed" | "ai_curate" | "explain", run: (task: RecommendationTask) => Promise<RecommendationItem[]>) {
    const preferences = await this.read();
    const sourceRevision = this.options.sourceRevision?.();
    const now = this.now(), id = crypto.randomUUID(), manual = ["manual_check", "explicit_seed", "ai_curate", "explain"].includes(reason);
    let acquired = false;
    const state = await this.edit(value => {
      acquired = false;
      if (value.lease && value.lease.until > now) return value;
      if (!manual && (value.pending ?? value.current)?.expiresAt! > now) return value;
      const recovering = Boolean(value.lease && value.lease.until <= now);
      const automaticRuns = value.automaticRuns.filter(at => at > now - DAY);
      const hours = this.automaticHours();
      if (!manual && (hours === 0 || !recovering && automaticRuns.length >= 1 || preferences.saved.filter(id => !preferences.feedback?.some(row => row.id === id && row.action === "read")).length >= this.unreadCap())) return value;
      acquired = true;
      return { ...value, lease: { id, root: recovering ? value.lease?.root ?? value.lease?.id : id, until: now + 46_000 }, automaticRuns: manual || recovering ? automaticRuns : [...automaticRuns, now], message: undefined };
    });
    if (!acquired) return state;
    if (!manual) {
      let allowed = false;
      await updateRecommendationRow<{ at: number; root: string }[]>(this.options.storage, recommendationStatePrefix + "schedule/" + feedHash(this.options.workspaceId ?? this.options.key), () => [], entries => {
        const recent = entries.filter(entry => entry.at > now - DAY);
        allowed = !recent.length || Boolean(state.lease?.root && recent.some(entry => entry.root === state.lease?.root));
        return !allowed || recent.some(entry => entry.root === state.lease?.root) ? recent : [...recent, { at: now, root: state.lease!.root! }];
      });
      if (!allowed) return this.edit(value => value.lease?.id === id ? { ...value, lease: undefined } : value);
    }
    const controller = new AbortController(); this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.min(45_000, this.options.deadlineMs ?? 45_000) - (this.now() - now)));
    const reservations: Record<string, number> = { provider: 0, embedding: 0, reranker: 0, generation: 0 };
    const counts: Record<string, number | string> = { provider: 0, embedding: 0, reranker: 0, generation: 0, trigger: reason, modelCost: "unknown" };
    const active = async () => { if (controller.signal.aborted || sourceRevision !== this.options.sourceRevision?.()) return false; const value = await this.read(); return value.epoch === state.epoch && value.lease?.id === id && value.lease.until > this.now(); };
    const heartbeat = setInterval(() => { void active().then(valid => { if (!valid) controller.abort(); }, () => controller.abort()); }, 1000);
    const task: RecommendationTask = { signal: controller.signal, active, upstreamUnknown: () => { counts.upstreamProviderRequests = "unknown-v1"; },
      request: async (kind, execute, units = 0) => {
        if (!await active()) { controller.abort(); throw new DOMException("Task revoked", "AbortError"); }
        const max = { provider: 6, embedding: 8, reranker: 2, generation: 2 }[kind];
        if (reservations[kind] >= max || kind === "generation" && (reservations.generation >= 1 || units > 8000)) throw new Error("本次推荐已达到请求额度，保留现有结果。");
        reservations[kind]++;
        const ledgerKey = kind === "provider" ? this.ledgerKey : recommendationStatePrefix + "budget/models";
        const at = this.now(), reservation = crypto.randomUUID();
        await updateRecommendationRow<Ledger>(this.options.storage, ledgerKey, () => ({ entries: [], active: [] }), value => {
          value.entries = value.entries.filter(entry => entry.at > at - DAY); value.active = value.active.filter(entry => entry.until > at);
          if ((value.cooldown ?? 0) > at) throw new Error("文献服务冷却中，保留已有推荐。");
          const used = value.entries.filter(entry => entry.kind === kind);
          if ((kind === "provider" && used.length >= 12) || (kind === "generation" && (used.length >= 2 || used.reduce((sum, entry) => sum + entry.units, 0) + units > 12000)) || (kind === "embedding" && used.reduce((sum, entry) => sum + entry.units, 0) + units > 50_000)) throw new Error("今日推荐额度已用完，仍可查看缓存。");
          if (value.active.filter(entry => kind === "provider" ? entry.kind === "provider" : entry.kind !== "provider").length >= (kind === "provider" ? 2 : 1)) throw new Error("推荐服务正忙，请稍后检查。");
          value.entries.push({ at, kind, units }); value.active.push({ id: reservation, kind, until: now + 46_000 }); return value;
        });
        counts[kind] = Number(counts[kind]) + 1;
        if (units) counts[`${kind}ReservedTokens`] = Number(counts[`${kind}ReservedTokens`] ?? 0) + units;
        if (kind === "generation") counts.generationOutputReservedTokens = 1500;
        try { return await execute(); }
        catch (error) {
          const status = (error as { status?: number }).status;
          if ([401, 403, 429].includes(status ?? 0)) await updateRecommendationRow<Ledger>(this.options.storage, ledgerKey, () => ({ entries: [], active: [] }), value => ({ ...value, cooldown: at + Math.max(60_000, Math.min(DAY, (error as { retryAfterMs?: number }).retryAfterMs ?? 3_600_000)) }));
          throw error;
        } finally { await updateRecommendationRow<Ledger>(this.options.storage, ledgerKey, () => ({ entries: [], active: [] }), value => ({ ...value, active: value.active.filter(entry => entry.id !== reservation) })); }
      } };
    try {
      let removeAbort = () => {};
      const aborted = new Promise<never>((_, reject) => { const abort = () => reject(new DOMException("Recommendation deadline exceeded", "AbortError")); controller.signal.addEventListener("abort", abort, { once: true }); removeAbort = () => controller.signal.removeEventListener("abort", abort); });
      let items: RecommendationItem[];
      try { items = (await Promise.race([run(task), aborted])).slice(0, 200); } finally { removeAbort(); }
      if (!await active()) return await this.edit(value => value.lease?.id === id ? { ...value, lease: undefined } : value);
      counts.elapsedMs = this.now() - now;
      const snapshot: FeedSnapshot = { id, sourceRevision, generatedAt: this.now(), expiresAt: this.now() + Math.max(6, this.automaticHours()) * 3_600_000, items, recipe: "stable-feed-v2" };
      return await this.edit(value => value.epoch !== state.epoch || value.lease?.id !== id || sourceRevision !== this.options.sourceRevision?.() ? value : { ...value, lease: undefined, usage: counts,
        ...(!value.current || manual ? { current: snapshot, pending: undefined, ...(reason === "ai_curate" ? { previous: value.current } : {}) } : { pending: snapshot }) });
    } catch (error) {
      return await this.edit(value => value.epoch !== state.epoch || value.lease?.id !== id ? value : { ...value, lease: undefined, usage: counts, message: controller.signal.aborted ? "更新已取消，保留上次推荐。" : `更新暂不可用，保留上次推荐。${error instanceof Error && error.name !== "ZodError" ? error.message.slice(0, 180) : "返回内容未通过校验，请重试。"}` });
    } finally { clearTimeout(timeout); clearInterval(heartbeat); if (this.controller === controller) this.controller = undefined; }
  }
}
