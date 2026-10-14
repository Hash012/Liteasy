import type { ObjectStorage, StorageRow } from "../objects/objectStorage";
import type { RecommendationItem } from "./recommendation.types";
export const recommendationStatePrefix = "recommendation/v2/";
const DAY = 86_400_000;
export const feedHash = (value: unknown) => { const text = JSON.stringify(value); let hash = 2166136261; for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return (hash >>> 0).toString(16); };
export type FeedSnapshot = { id: string; generatedAt: number; expiresAt: number; items: RecommendationItem[]; recipe: "stable-feed-v2" };
type Lease = { id: string; until: number };
export type FeedState = { epoch: number; current?: FeedSnapshot; pending?: FeedSnapshot; lease?: Lease; automaticRuns: number[]; hidden: string[]; saved: string[]; message?: string; usage?: Record<string, number | string> };
type Ledger = { entries: { at: number; kind: string; units: number }[]; active: { id: string; until: number; kind: string }[]; cooldown?: number };
export type RecommendationTask = { signal: AbortSignal; active: () => Promise<boolean>; request: <T>(kind: "provider" | "embedding" | "reranker" | "generation", run: () => Promise<T>, units?: number) => Promise<T>; upstreamUnknown: () => void };
const empty = (): FeedState => ({ epoch: 0, automaticRuns: [], hidden: [], saved: [] });
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
  constructor(private options: { storage: ObjectStorage; scope: string; key: string; provider: string; now?: () => number; automaticHours?: number; unreadCap?: number }) {
    this.key = recommendationStatePrefix + "feed/" + options.key;
    this.ledgerKey = recommendationStatePrefix + "budget/" + options.provider;
  }
  private now() { return (this.options.now ?? Date.now)(); }
  async read(): Promise<FeedState> { return (await this.options.storage.get(this.key))?.value as FeedState ?? empty(); }
  private edit(fn: (value: FeedState) => FeedState) { return updateRecommendationRow(this.options.storage, this.key, empty, fn); }
  async clear() { this.controller?.abort(); return this.edit(value => ({ ...empty(), epoch: value.epoch + 1 })); }
  cancel() { this.controller?.abort(); }
  async acceptPending() { return this.edit(value => value.pending ? { ...value, current: value.pending, pending: undefined } : value); }
  async feedback(id: string, action: "saved" | "dismissed") {
    return this.edit(value => ({ ...value, [action === "saved" ? "saved" : "hidden"]: [...new Set([...(action === "saved" ? value.saved : value.hidden), id])].slice(-500) }));
  }
  async refresh(reason: "initial" | "scheduled" | "manual_check" | "explicit_seed", run: (task: RecommendationTask) => Promise<RecommendationItem[]>) {
    const now = this.now(), id = crypto.randomUUID(), manual = reason === "manual_check" || reason === "explicit_seed";
    let acquired = false;
    const state = await this.edit(value => {
      acquired = false;
      if (value.lease && value.lease.until > now) return value;
      if (!manual && (value.pending ?? value.current)?.expiresAt! > now) return value;
      const automaticRuns = value.automaticRuns.filter(at => at > now - DAY);
      const hours = this.options.automaticHours ?? 24;
      if (!manual && (hours === 0 || automaticRuns.length >= 1 || value.saved.length >= (this.options.unreadCap ?? 9))) return value;
      acquired = true;
      return { ...value, lease: { id, until: now + 46_000 }, automaticRuns: manual ? automaticRuns : [...automaticRuns, now], message: undefined };
    });
    if (!acquired) return state;
    const controller = new AbortController(); this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 45_000);
    const counts: Record<string, number | string> = { provider: 0, embedding: 0, reranker: 0, generation: 0 };
    const active = async () => { if (controller.signal.aborted) return false; const value = await this.read(); return value.epoch === state.epoch && value.lease?.id === id && value.lease.until > this.now(); };
    const task: RecommendationTask = { signal: controller.signal, active, upstreamUnknown: () => { counts.upstreamProviderRequests = "unknown-v1"; },
      request: async (kind, execute, units = 0) => {
        if (!await active()) { controller.abort(); throw new DOMException("Task revoked", "AbortError"); }
        const max = { provider: 6, embedding: 8, reranker: 2, generation: 2 }[kind];
        if (Number(counts[kind]) >= max) throw new Error("本次推荐已达到请求额度，保留现有结果。");
        const at = this.now(), reservation = crypto.randomUUID();
        await updateRecommendationRow<Ledger>(this.options.storage, this.ledgerKey, () => ({ entries: [], active: [] }), value => {
          value.entries = value.entries.filter(entry => entry.at > at - DAY); value.active = value.active.filter(entry => entry.until > at);
          if ((value.cooldown ?? 0) > at) throw new Error("文献服务冷却中，保留已有推荐。");
          const used = value.entries.filter(entry => entry.kind === kind);
          if ((kind === "provider" && used.length >= 12) || (kind === "generation" && used.length >= 2) || (kind === "embedding" && used.reduce((sum, entry) => sum + entry.units, 0) + units > 50_000)) throw new Error("今日推荐额度已用完，仍可查看缓存。");
          if (value.active.filter(entry => kind === "provider" ? entry.kind === "provider" : entry.kind !== "provider").length >= (kind === "provider" ? 2 : 1)) throw new Error("推荐服务正忙，请稍后检查。");
          value.entries.push({ at, kind, units }); value.active.push({ id: reservation, kind, until: now + 46_000 }); return value;
        });
        counts[kind] = Number(counts[kind]) + 1;
        try { return await execute(); }
        catch (error) {
          const status = (error as { status?: number }).status;
          if ([401, 403, 429].includes(status ?? 0)) await updateRecommendationRow<Ledger>(this.options.storage, this.ledgerKey, () => ({ entries: [], active: [] }), value => ({ ...value, cooldown: at + Math.max(60_000, Math.min(DAY, (error as { retryAfterMs?: number }).retryAfterMs ?? 3_600_000)) }));
          throw error;
        } finally { await updateRecommendationRow<Ledger>(this.options.storage, this.ledgerKey, () => ({ entries: [], active: [] }), value => ({ ...value, active: value.active.filter(entry => entry.id !== reservation) })); }
      } };
    try {
      const items = (await run(task)).slice(0, 200);
      if (!await active()) return await this.read();
      const snapshot: FeedSnapshot = { id, generatedAt: this.now(), expiresAt: this.now() + Math.max(6, this.options.automaticHours ?? 24) * 3_600_000, items, recipe: "stable-feed-v2" };
      return await this.edit(value => value.epoch !== state.epoch || value.lease?.id !== id ? value : { ...value, lease: undefined, usage: counts,
        ...(!value.current || manual ? { current: snapshot, pending: undefined } : { pending: snapshot }) });
    } catch (error) {
      return await this.edit(value => value.epoch !== state.epoch || value.lease?.id !== id ? value : { ...value, lease: undefined, usage: counts, message: controller.signal.aborted ? "更新已取消，保留上次推荐。" : `更新暂不可用，保留上次推荐。${String(error)}` });
    } finally { clearTimeout(timeout); if (this.controller === controller) this.controller = undefined; }
  }
}
