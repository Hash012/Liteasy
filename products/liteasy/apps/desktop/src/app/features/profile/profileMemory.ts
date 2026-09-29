import { z } from "zod";
import type { AgentMemoryEntry } from "../agent-core/agentCoreConfig";
import { loadAgentPersonalization } from "../agent-core/agentPersonalization";
import type { AcademicProfile } from "./profile.types";
import { toRecommendationResearchProfile } from "./profile.types";

export const memoryFields = {
  research_topic: "研究主题", research_method: "常用方法", dataset: "关注数据集",
  reading_language: "阅读语言", response_language: "回答语言", response_style: "回答方式",
  research_stage: "研究阶段", project: "当前研究项目", context: "其他偏好"
} as const;
export type MemoryField = keyof typeof memoryFields;
const fieldSchema = z.enum(Object.keys(memoryFields) as [MemoryField, ...MemoryField[]]);
const entrySchema = z.object({
  id: z.string().min(1).max(160), field: fieldSchema, value: z.string().min(1).max(240),
  source: z.enum(["manual", "conversation"]), updatedAt: z.string().datetime(),
  evidence: z.string().max(400).optional(), sessionId: z.string().max(200).optional(),
  replacesId: z.string().max(160).optional()
});
export type ProfileMemoryEntry = z.infer<typeof entrySchema>;
const schema = z.object({
  schemaVersion: z.literal(1), revision: z.number().int().nonnegative(),
  automatic: z.boolean(), entries: z.array(entrySchema).max(48), pending: z.array(entrySchema).max(12),
  recentState: z.string().max(1200),
  cadence: z.object({ turns: z.number().int().nonnegative(), checkedTurn: z.number().int().nonnegative(),
    lastCheck: z.number().nonnegative(), day: z.string().max(10), dailyChecks: z.number().int().nonnegative(),
    sessions: z.record(z.string(), z.number().int().nonnegative()) }),
  blocked: z.array(z.string().max(300)).max(100)
});
export type ProfileMemory = z.infer<typeof schema>;
export const profileMemoryEvent = "liteasy-profile-memory-changed";
const storageKey = (scope: string) => `liteasy.profile-memory.v1:${scope}`;
export function emptyProfileMemory(): ProfileMemory {
  return { schemaVersion: 1, revision: 0, automatic: true, entries: [], pending: [], recentState: "",
    cadence: { turns: 0, checkedTurn: 0, lastCheck: 0, day: "", dailyChecks: 0, sessions: {} }, blocked: [] };
}
export function loadProfileMemory(scope: string): { data: ProfileMemory; error?: string } {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (raw !== null) {
      const parsed = schema.safeParse(JSON.parse(raw));
      return parsed.success ? { data: parsed.data } : { data: emptyProfileMemory(), error: "画像格式无法读取，已保留原始数据。请使用兼容的应用版本。" };
    }
    const legacy = loadAgentPersonalization(scope);
    return { data: { ...emptyProfileMemory(), recentState: legacy.recentStateOverride,
      entries: legacy.memories.filter((entry) => entry.summary.trim()).slice(0, 48).map((entry) => ({
        id: entry.id, field: "context", value: entry.summary.slice(0, 240), source: "manual", updatedAt: new Date().toISOString()
      })) } };
  } catch { return { data: emptyProfileMemory(), error: "无法读取本机画像，原始数据未被覆盖。" }; }
}
export function saveProfileMemory(scope: string, data: ProfileMemory, expectedRevision: number): ProfileMemory {
  const current = loadProfileMemory(scope);
  if (current.error) throw new Error(current.error);
  if (current.data.revision !== expectedRevision) throw new Error("画像刚刚发生变化，请重试。");
  const next = schema.parse({ ...data, revision: expectedRevision + 1 });
  localStorage.setItem(storageKey(scope), JSON.stringify(next));
  window.dispatchEvent(new Event(profileMemoryEvent));
  return next;
}
export const memoryFingerprint = (entry: Pick<ProfileMemoryEntry, "field" | "value">) => `${entry.field}:${entry.value.normalize("NFKC").toLowerCase().replace(/\s+/g, "").trim()}`;
export function profileMemoryAgentEntries(memory: ProfileMemory): AgentMemoryEntry[] {
  return memory.entries.map((entry) => ({ id: entry.id, namespace: "local-user", importance: "中", type: "偏好",
    summary: `${memoryFields[entry.field]}：${entry.value}` }));
}
export function profileMemorySummary(memory: ProfileMemory, kind: "all" | "response" = "all") {
  return memory.entries.filter((entry) => kind === "all" || entry.field.startsWith("response_"))
    .slice(0, kind === "all" ? 20 : 4).map((entry) => `${memoryFields[entry.field]}：${entry.value}`).join("；").slice(0, 2200);
}
export function profileRecommendationPreferences(academic: AcademicProfile, memory: ProfileMemory) {
  const base = toRecommendationResearchProfile(academic) ?? { topics: [], methods: [], datasets: [], languages: [] };
  const values = (field: MemoryField) => memory.entries.filter((entry) => entry.field === field).map((entry) => entry.value);
  const merge = (a: string[], b: string[]) => [...new Set([...a, ...b])].slice(0, 12);
  return { topics: merge(base.topics, values("research_topic")), methods: merge(base.methods, values("research_method")),
    datasets: merge(base.datasets, values("dataset")), languages: merge(base.languages, values("reading_language")) };
}
