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
  return {
    load() {
      if (typeof window === "undefined" || !window.localStorage) {
        return null;
      }
      const serialized = window.localStorage.getItem(browserStorageKey);
      return serialized ? JSON.parse(serialized) : null;
    },
    save(snapshot) {
      if (typeof window === "undefined" || !window.localStorage) {
        return;
      }
      window.localStorage.setItem(browserStorageKey, JSON.stringify(snapshot));
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
  return {
    load: async () => (await storage.get("agent-state/public"))?.value ?? null,
    save: async (snapshot) => {
      const key = "agent-state/public";
      const previous = await storage.get(key);
      await storage.commit([
        {
          key,
          expected: previous?.version ?? null,
          row: { key, version: crypto.randomUUID(), value: snapshot },
        },
      ]);
    },
  };
}
