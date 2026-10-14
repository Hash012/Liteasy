import type { ContextCatalogPort } from "./catalogPort";
import { contextDomain, contextKind } from "../assistant/contextCatalogQuery";
import { readPickerRecord, writePickerRecord } from "./pickerState";

export type PickerActivity = { id: string; at: number; kind: "viewed" | "foreground-dwell" | "created" | "attached" | "sent" | "undone"; origin: "reader" | "editor" | "picker_preview" | "picker"; durationMs?: number };
export type RecommendationSettings = { enabled: boolean; recentReading: boolean; recentCreated: boolean; draftSimilarity: boolean; projectFirst: boolean; count: number };
export const defaultRecommendationSettings: RecommendationSettings = { enabled: true, recentReading: false, recentCreated: true, draftSimilarity: true, projectFirst: true, count: 6 };
const settingsKey = (scope: string) => `liteasy:context-picker:recommendations:${scope}`;
const activityKey = (scope: string) => `liteasy:context-picker:activity:${scope}`;
export function readRecommendationSettings(scope: string): RecommendationSettings {
  const value = readPickerRecord<Partial<RecommendationSettings>>(settingsKey(scope));
  const settings = { ...defaultRecommendationSettings };
  for (const key of ["enabled", "recentReading", "recentCreated", "draftSimilarity", "projectFirst"] as const) if (typeof value?.[key] === "boolean") settings[key] = value[key]!;
  if (value?.count && Number.isSafeInteger(value.count)) settings.count = Math.max(4, Math.min(12, value.count));
  return settings;
}
export function saveRecommendationSettings(scope: string, settings: RecommendationSettings) { writePickerRecord(settingsKey(scope), settings); window.dispatchEvent(new Event("liteasy:context-picker:recommendations")); }
export function readPickerActivity(scope: string, now = Date.now()): PickerActivity[] {
  const raw = readPickerRecord<PickerActivity[]>(activityKey(scope));
  return Array.isArray(raw) ? raw.filter(event => typeof event?.id === "string" && Number.isFinite(event.at) && event.at <= now && event.at >= now - 30 * 86400000).slice(-2000) : [];
}
export function recordPickerActivity(scope: string, event: PickerActivity) {
  const settings = readRecommendationSettings(scope);
  if (!settings.enabled || !settings.recentReading && ["viewed", "foreground-dwell"].includes(event.kind) || !settings.recentCreated && event.kind === "created" || event.origin === "picker_preview") return;
  writePickerRecord(activityKey(scope), [...readPickerActivity(scope), event].slice(-2000));
}
export function clearPickerActivity(scope: string) { writePickerRecord(activityKey(scope), []); }
export type PickerInvocation = { now: number; activePaperId?: string; activeAssetId?: string; question?: string; excludedIds?: string[] };
export type Recommendation = { id: string; score: number; reason: string };
export function recommendContextAssets(catalog: ContextCatalogPort, invocation: PickerInvocation, events: PickerActivity[], settings: RecommendationSettings): Recommendation[] {
  if (!settings.enabled) return [];
  const excluded = new Set(invocation.excludedIds), recent = new Map<string, number>();
  for (const event of events) if (event.at <= invocation.now && event.origin === "reader" && ["viewed", "foreground-dwell"].includes(event.kind)) recent.set(event.id, Math.max(recent.get(event.id) ?? 0, event.at));
  const words = (invocation.question ?? "").toLocaleLowerCase().split(/[\s，。！？、,.!?]+/u).filter(word => word.length > 1);
  const candidates: Recommendation[] = [];
  for (const asset of catalog.assets) {
    if (asset.unavailableReason || excluded.has(asset.id) || contextDomain(asset) !== "research" || contextKind(asset) === "project") continue;
    const relation = catalog.relations.get(asset.id);
    const created = Date.parse(relation?.createdAt ?? "") || 0;
    if (created > invocation.now) continue;
    const active = asset.id === invocation.activeAssetId ? 1 : invocation.activePaperId && relation?.paperIds.includes(invocation.activePaperId) ? 0.8 : 0;
    const readAt = settings.recentReading ? recent.get(asset.id) ?? 0 : 0;
    const read = readAt ? Math.exp(-(invocation.now - readAt) / (7 * 86400000)) : 0;
    const userCreated = ["user", "external", "mixed"].includes(asset.searchMetadata?.origin ?? "");
    const fresh = settings.recentCreated && created && userCreated ? Math.exp(-(invocation.now - created) / (3 * 86400000)) : 0;
    const text = `${asset.label} ${asset.summary ?? ""} ${(asset.searchMetadata?.tags ?? []).join(" ")}`.toLocaleLowerCase();
    const similar = settings.draftSimilarity && words.length ? words.filter(word => text.includes(word)).length / words.length : 0;
    const score = .32 * active + .20 * read + .15 * fresh + .15 * similar + (settings.projectFirst && active ? .10 * active : 0);
    if (!score) continue;
    const reason = active ? "当前阅读相关" : fresh > read && fresh > similar ? "最近创建" : read >= similar && read ? "最近阅读" : "与当前问题相关";
    candidates.push({ id: asset.id, score, reason });
  }
  return candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 200).slice(0, settings.count);
}
export function evaluateRecommendations(cases: Array<{ expected: string[]; ranked: string[]; recentBaseline: string[] }>, k = 6) {
  const score = (field: "ranked" | "recentBaseline") => {
    let hits = 0, recall = 0, mrr = 0;
    for (const item of cases) {
      const ranked = item[field].slice(0, k), matched = ranked.filter(id => item.expected.includes(id));
      if (matched.length) { hits++; mrr += 1 / (ranked.findIndex(id => item.expected.includes(id)) + 1); }
      recall += item.expected.length ? matched.length / item.expected.length : 0;
    }
    return { hitRate: cases.length ? hits / cases.length : 0, recall: cases.length ? recall / cases.length : 0, mrr: cases.length ? mrr / cases.length : 0 };
  };
  return { cases: cases.length, k, ranked: score("ranked"), recentBaseline: score("recentBaseline"), evidence: "offline replay; no live effectiveness claim" };
}
