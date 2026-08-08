import type { AgentMemoryEntry } from "./agentCoreConfig";

export type AgentMemorySearchOptions = {
  limit?: number;
  namespace?: string;
  query: string;
};

export type AgentMemoryStore = {
  list: () => AgentMemoryEntry[];
  remember: (entry: AgentMemoryEntry) => void;
  search: (options: AgentMemorySearchOptions) => AgentMemoryEntry[];
};

const importanceScore: Record<AgentMemoryEntry["importance"], number> = {
  高: 3,
  中: 2,
  低: 1
};

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[\s,，。；;:：、/\\|()[\]{}"'`]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function scoreMemory(queryTokens: string[], memory: AgentMemoryEntry) {
  const haystack = `${memory.type} ${memory.namespace} ${memory.summary}`.toLowerCase();
  const keywordHits = queryTokens.filter((token) => haystack.includes(token)).length;

  /*
   * 这是一个故意简单的 hybrid scoring：
   * - keywordHits 让当前问题相关的记忆排在前面。
   * - importanceScore 让“高重要性”的身份/偏好/项目约束即使没完全命中也能被保留。
   *
   * 后续接入 embedding 或 SQLite FTS 时，可以把这个函数替换成
   * semantic_similarity + keyword + importance + freshness 的混合分数。
   */
  return keywordHits * 4 + importanceScore[memory.importance];
}

export function createAgentMemoryStore(initialMemories: AgentMemoryEntry[]): AgentMemoryStore {
  const memories = [...initialMemories];

  return {
    list() {
      return [...memories];
    },

    remember(entry) {
      const existingIndex = memories.findIndex((memory) => memory.id === entry.id);
      if (existingIndex >= 0) {
        memories[existingIndex] = entry;
        return;
      }

      memories.push(entry);
    },

    search({ limit = 4, namespace, query }) {
      const queryTokens = tokenize(query);

      return memories
        .filter((memory) => !namespace || memory.namespace === namespace)
        .map((memory) => ({
          memory,
          score: scoreMemory(queryTokens, memory)
        }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, limit)
        .map((item) => item.memory);
    }
  };
}

