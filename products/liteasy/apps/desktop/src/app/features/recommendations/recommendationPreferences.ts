import { useMemo, useSyncExternalStore } from "react";
import { z } from "zod";
import { resolveLocalAccountKey } from "../library/localAccountKey";
const provider = z.object({ endpoint: z.string().max(2048).default(""), model: z.string().max(200).default(""), dimensions: z.number().int().min(1).max(4096).optional(), revision: z.string().max(200).optional(), task: z.string().max(100).optional(), normalization: z.string().max(100).optional() });
const schema = z.object({ version: z.literal(2), consentEpoch: z.number().int().min(0).default(0), generationEnabled: z.boolean().default(false),
  feed: z.object({ displayCount: z.number().int().min(1).max(5).default(3), automaticHours: z.union([z.literal(0), z.number().min(6).max(168)]).default(24), unreadCap: z.number().int().min(1).max(100).default(9) }).default({ displayCount: 3, automaticHours: 24, unreadCap: 9 }),
  signals: z.object({ readingActivity: z.boolean().default(false), userQuestions: z.boolean().default(false) }).default({ readingActivity: false, userQuestions: false }),
  privacy: z.object({ externalDerivedQueries: z.boolean().default(false), externalPrivateVectors: z.boolean().default(false) }).default({ externalDerivedQueries: false, externalPrivateVectors: false }), hybridEnabled: z.boolean(), useAnnotations: z.boolean(), useProfile: z.boolean(), sendPrivateText: z.boolean(),
  embedding: provider, reranker: provider });
export type RecommendationPreferences = z.infer<typeof schema>;
export const recommendationPreferencesEvent = "liteasy-recommendation-preferences";
export const defaultRecommendationPreferences = schema.parse({ version: 2, hybridEnabled: false, useAnnotations: true, useProfile: true, sendPrivateText: false,
  embedding: { endpoint: "", model: "" }, reranker: { endpoint: "", model: "" } });
const key = () => `liteasy.recommendation-preferences.v1:${resolveLocalAccountKey()}`;
const read = () => { try { return localStorage.getItem(key()) ?? ""; } catch { return ""; } };
export function parseRecommendationPreferences(raw: string) {
  try { const value = JSON.parse(raw); return schema.parse(value?.version === 1 ? { ...value, version: 2 } : value); } catch { return defaultRecommendationPreferences; }
}
export function loadRecommendationPreferences() { return parseRecommendationPreferences(read()); }
export function saveRecommendationPreferences(value: RecommendationPreferences) {
  let existing: { version?: number } = {};
  try { existing = JSON.parse(read() || "{}"); } catch { /* An explicitly saved setting can replace invalid local JSON. */ }
  if (typeof existing?.version === "number" && existing.version > 2) throw new Error("推荐设置来自更新版本，请升级应用；原数据已保留。");
  const previous = parseRecommendationPreferences(read());
  const permissionsChanged = JSON.stringify([previous.signals, previous.sendPrivateText, previous.useAnnotations, previous.privacy]) !== JSON.stringify([value.signals, value.sendPrivateText, value.useAnnotations, value.privacy]);
  const next = schema.parse({ ...value, consentEpoch: Math.max(value.consentEpoch, previous.consentEpoch + Number(permissionsChanged)) }); localStorage.setItem(key(), JSON.stringify(next));
  window.dispatchEvent(new Event(recommendationPreferencesEvent));
}
const subscribe = (fn: () => void) => { window.addEventListener(recommendationPreferencesEvent, fn); window.addEventListener("storage", fn);
  return () => { window.removeEventListener(recommendationPreferencesEvent, fn); window.removeEventListener("storage", fn); }; };
export function useRecommendationPreferences() {
  const raw = useSyncExternalStore(subscribe, read, () => "");
  return useMemo(() => parseRecommendationPreferences(raw), [raw]);
}
