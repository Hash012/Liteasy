import { createObjectStorage } from "../../features/objects/objectStorage";
import { invoke } from "@tauri-apps/api/core";
import type {
  AgentStateSnapshot,
  AgentStateStore,
} from "./agentStatePersistence";

const browserStorageKey = "liteasy.agent-state.v1";

type AgentStateTransport = {
  load: () => Promise<unknown>;
  save: (snapshot: AgentStateSnapshot) => Promise<void>;
};

function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
  );
}

function createBrowserStateStore(): AgentStateStore {
  let loaded: string | null | undefined;
  return {
    load() {
      if (typeof window === "undefined" || !window.localStorage) {
        return null;
      }
      const serialized = window.localStorage.getItem(browserStorageKey);
      const parsed = serialized ? JSON.parse(serialized) : null;
      loaded = serialized;
      return parsed;
    },
    save(snapshot) {
      if (typeof window === "undefined" || !window.localStorage) {
        return;
      }
      if (loaded === undefined || window.localStorage.getItem(browserStorageKey) !== loaded) {
        throw new Error("会话已被修改或尚未读取，原数据已保留，请重新打开。");
      }
      const next = JSON.stringify(snapshot);
      window.localStorage.setItem(browserStorageKey, next);
      loaded = next;
    },
  };
}

function createTauriTransport(): AgentStateTransport {
  return {
    load: () => invoke<unknown>("load_agent_state"),
    save: (snapshot) => invoke<void>("save_agent_state", { snapshot }),
  };
}

export function createTauriAgentStateStore(
  transport?: AgentStateTransport,
): AgentStateStore {
  if (!transport && !isTauriRuntime()) {
    return createBrowserStateStore();
  }
  const activeTransport = transport ?? createTauriTransport();
  return {
    load: () => activeTransport.load(),
    save: (snapshot) => activeTransport.save(snapshot),
  };
}

/** Object-aware sessions share the account-checked transaction boundary, not global browser state. */
export function createScopedAgentStateStore(
  scopeId: string,
  currentScope: () => string,
): AgentStateStore {
  const storage = createObjectStorage(scopeId, currentScope);
  let loadedVersion: string | null | undefined;
  return {
    load: async () => {
      const row = await storage.get("agent-state/public");
      loadedVersion = row?.version ?? null;
      return row?.value ?? null;
    },
    save: async (snapshot) => {
      const key = "agent-state/public";
      if (loadedVersion === undefined) throw new Error("保存前须先读取会话。");
      const version = crypto.randomUUID();
      await storage.commit([
        {
          key,
          expected: loadedVersion,
          row: { key, version, value: snapshot },
        },
      ]);
      loadedVersion = version;
    },
  };
}
