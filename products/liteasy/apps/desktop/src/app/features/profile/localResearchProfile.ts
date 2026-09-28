import type { PersonalizationSignal, UserTag } from "./academicProfileClient";
import { resolveLocalAccountKey } from "../library/localAccountKey";
type Event = { at: string; signal: PersonalizationSignal };
export type LocalResearchProfile = { version: number; events: Event[] };
const key = () => `liteasy.local-research-profile.v1:${resolveLocalAccountKey()}`;
export function loadLocalResearchProfile(): LocalResearchProfile {
  try { const value = JSON.parse(localStorage.getItem(key()) ?? "null");
    if (Number.isSafeInteger(value?.version) && Array.isArray(value?.events)) return { version: value.version, events: value.events.filter((item: Event) => typeof item?.at === "string" && item.signal && ((["paper_opened", "recommendation_saved"].includes(item.signal.kind) && "title" in item.signal && typeof item.signal.title === "string") || (item.signal.kind === "recommendation_dismissed" && typeof item.signal.recommendationId === "string"))).slice(-500) };
  } catch { /* An empty local profile remains usable offline. */ }
  return { version: 0, events: [] };
}
export function recordLocalResearchSignal(signal: PersonalizationSignal, now = new Date()) {
  const current = loadLocalResearchProfile();
  const normalized: PersonalizationSignal = "title" in signal ? { ...signal, title: signal.title.slice(0, 1000) } : signal;
  // Opening the same paper repeatedly in one day must not dominate the profile.
  if (current.events.some((item) => item.at.slice(0, 10) === now.toISOString().slice(0, 10) && JSON.stringify(item.signal) === JSON.stringify(normalized))) return current;
  const next = { version: current.version + 1, events: [...current.events, { at: now.toISOString(), signal: normalized }].slice(-500) };
  localStorage.setItem(key(), JSON.stringify(next));
  return next;
}
export function localProfileTags(profile: LocalResearchProfile): UserTag[] {
  const words = new Map<string, { count: number; weight: number }>();
  const stop = new Set("the and for with from into using based study analysis paper research that this are all new via towards approach method of to in on a an is as by we it our its these review 研究 方法 基于 一种 分析 应用".split(" "));
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  for (const event of profile.events) {
    if (!("title" in event.signal)) continue;
    const terms = new Set([...segmenter.segment(event.signal.title)].filter((part) => part.isWordLike).map((part) => part.segment.toLocaleLowerCase()).filter((word) => word.length >= 2 && !stop.has(word)));
    for (const word of terms) { const old = words.get(word) ?? { count: 0, weight: 0 }; words.set(word, { count: old.count + 1, weight: old.weight + (event.signal.kind === "recommendation_saved" ? 3 : 1) }); }
  }
  return [...words.entries()].sort((a, b) => b[1].weight - a[1].weight || a[0].localeCompare(b[0])).slice(0, 24)
    .map(([label, value]) => ({ label, weight: Math.min(1, value.weight / 10), evidenceCount: value.count, signalSource: "本机阅读与收藏标题" }));
}
export function clearLocalResearchProfile() { localStorage.removeItem(key()); window.dispatchEvent(new Event("liteasy-local-profile-changed")); }
export function exportLocalResearchProfile() {
  const profile = loadLocalResearchProfile();
  const blob = new Blob([JSON.stringify({ schema: "liteasy.local-research-profile/v1", exportedAt: new Date().toISOString(), ...profile, tags: localProfileTags(profile) }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "Liteasy-local-research-profile.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
