import { invoke } from "@tauri-apps/api/core";
import type {
  AgentStateSnapshot,
  AgentStateStore
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
    }
  };
}

function createTauriTransport(): AgentStateTransport {
  return {
    load: () => invoke<unknown>("load_agent_state"),
    save: (snapshot) => invoke<void>("save_agent_state", { snapshot })
  };
}

export function createTauriAgentStateStore(
  transport?: AgentStateTransport
): AgentStateStore {
  if (!transport && !isTauriRuntime()) {
    return createBrowserStateStore();
  }
  const activeTransport = transport ?? createTauriTransport();
  return {
    load: () => activeTransport.load(),
    save: (snapshot) => activeTransport.save(snapshot)
  };
}
