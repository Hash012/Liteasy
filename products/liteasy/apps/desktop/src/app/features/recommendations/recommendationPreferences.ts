import { useMemo, useSyncExternalStore } from "react";
import { z } from "zod";
import { resolveLocalAccountKey } from "../library/localAccountKey";
const provider = z.object({ endpoint: z.string().max(2048).default(""), model: z.string().max(200).default(""), dimensions: z.number().int().min(1).max(4096).optional() });
const schema = z.object({ version: z.literal(1), hybridEnabled: z.boolean(), useAnnotations: z.boolean(), useProfile: z.boolean(), sendPrivateText: z.boolean(),
  embedding: provider, reranker: provider });
export type RecommendationPreferences = z.infer<typeof schema>;
export const recommendationPreferencesEvent = "liteasy-recommendation-preferences";
export const defaultRecommendationPreferences: RecommendationPreferences = { version: 1, hybridEnabled: false, useAnnotations: true, useProfile: true, sendPrivateText: false,
  embedding: { endpoint: "", model: "" }, reranker: { endpoint: "", model: "" } };
const key = () => `liteasy.recommendation-preferences.v1:${resolveLocalAccountKey()}`;
const read = () => { try { return localStorage.getItem(key()) ?? ""; } catch { return ""; } };
export function parseRecommendationPreferences(raw: string) {
  try { return schema.parse(JSON.parse(raw)); } catch { return defaultRecommendationPreferences; }
}
export function loadRecommendationPreferences() { return parseRecommendationPreferences(read()); }
export function saveRecommendationPreferences(value: RecommendationPreferences) {
  let existing: { version?: number } = {};
  try { existing = JSON.parse(read() || "{}"); } catch { /* An explicitly saved setting can replace invalid local JSON. */ }
  if (typeof existing?.version === "number" && existing.version > 1) throw new Error("推荐设置来自更新版本，请升级应用；原数据已保留。");
  const next = schema.parse(value); localStorage.setItem(key(), JSON.stringify(next));
  window.dispatchEvent(new Event(recommendationPreferencesEvent));
}
const subscribe = (fn: () => void) => { window.addEventListener(recommendationPreferencesEvent, fn); window.addEventListener("storage", fn);
  return () => { window.removeEventListener(recommendationPreferencesEvent, fn); window.removeEventListener("storage", fn); }; };
export function useRecommendationPreferences() {
  const raw = useSyncExternalStore(subscribe, read, () => "");
  return useMemo(() => parseRecommendationPreferences(raw), [raw]);
}
