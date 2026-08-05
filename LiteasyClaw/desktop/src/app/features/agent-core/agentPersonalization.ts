import { defaultAgentCoreConfig, type AgentMemoryEntry } from "./agentCoreConfig";

const personalizationStorageKey = "liteasy.agent-personalization.v1";

export type AgentPersonalization = {
  memories: AgentMemoryEntry[];
  recentStateOverride: string;
};

function cloneMemories(memories: AgentMemoryEntry[]) {
  return memories.map((memory) => ({ ...memory }));
}

function isMemoryEntry(value: unknown): value is AgentMemoryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<AgentMemoryEntry>;
  return typeof candidate.id === "string" && candidate.id.length > 0 &&
    typeof candidate.namespace === "string" && typeof candidate.summary === "string" &&
    ["高", "中", "低"].includes(String(candidate.importance)) &&
    ["偏好", "画像", "项目", "经历"].includes(String(candidate.type));
}

export function createDefaultAgentPersonalization(): AgentPersonalization {
  return {
    memories: cloneMemories(defaultAgentCoreConfig.memories),
    recentStateOverride: ""
  };
}

export function loadAgentPersonalization(): AgentPersonalization {
  const fallback = createDefaultAgentPersonalization();
  try {
    const serialized = globalThis.localStorage?.getItem(personalizationStorageKey);
    if (!serialized) return fallback;
    const parsed = JSON.parse(serialized) as Partial<AgentPersonalization>;
    return {
      memories: Array.isArray(parsed.memories) && parsed.memories.every(isMemoryEntry)
        ? cloneMemories(parsed.memories)
        : fallback.memories,
      recentStateOverride: typeof parsed.recentStateOverride === "string"
        ? parsed.recentStateOverride.slice(0, 1200)
        : ""
    };
  } catch {
    return fallback;
  }
}

export function saveAgentPersonalization(personalization: AgentPersonalization) {
  try {
    globalThis.localStorage?.setItem(
      personalizationStorageKey,
      JSON.stringify({
        memories: cloneMemories(personalization.memories),
        recentStateOverride: personalization.recentStateOverride.slice(0, 1200)
      })
    );
  } catch {
    // 本地存储不可用时，当前会话中的 Agent 偏好仍然生效。
  }
}
