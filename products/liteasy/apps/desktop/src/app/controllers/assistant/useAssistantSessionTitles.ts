import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { getAccountSessionGeneration } from "../../features/account/accountSessionStorage";
import { createSessionTitleCoordinator, generateSessionTitle, renameAssistantSessionWithAI } from "../../features/assistant/assistantSessionTitles";
import type { AssistantSessionHistoryItem } from "../../features/assistant/assistantSessionHistory";
import { createModelGatewayFromSettings } from "../../features/models/modelRuntime";
import { getActiveModelProvider, getModelForSettings } from "../../features/models/modelPolicy";
import type { ModelTransport } from "../../features/models/modelHttpClient";
import type { SettingsState } from "../../features/settings/settings.types";

export function useAssistantSessionTitles(input: {
  scope: string;
  ready: boolean;
  sessions: AssistantSessionHistoryItem[];
  registry: MutableRefObject<AssistantSessionHistoryItem[]>;
  getSettings(): SettingsState;
  modelTransport?: ModelTransport;
  publish(sessions: AssistantSessionHistoryItem[]): void;
  loadSession?(id: string): Promise<AssistantSessionHistoryItem | undefined>;
}) {
  const latest = useRef(input);
  latest.current = input;
  const explicitRequests = useRef(new Map<string, AbortController>());
  const coordinator = useRef<ReturnType<typeof createSessionTitleCoordinator>>();
  const historyBaseline = useRef<{ scope: string; captured: boolean; ids: Set<string> }>({ scope: input.scope, captured: false, ids: new Set() });
  if (historyBaseline.current.scope !== input.scope) historyBaseline.current = { scope: input.scope, captured: false, ids: new Set() };
  useEffect(() => {
    const owner = createSessionTitleCoordinator({
      getSessions: () => latest.current.registry.current.filter(session => !historyBaseline.current.ids.has(session.id)),
      getScope: () => latest.current.scope,
      getGeneration: getAccountSessionGeneration,
      generate: (turn, signal) => {
        const settings = latest.current.getSettings();
        return generateSessionTitle(turn, createModelGatewayFromSettings(settings, { cloudTransport: latest.current.modelTransport }),
          { model: getModelForSettings(settings), provider: getActiveModelProvider(settings) }, signal);
      },
      update: (id, change) => {
        const current = latest.current;
        let changed = false;
        const next = current.registry.current.map(session => {
          const updated = session.id === id ? change(session) : session;
          if (updated !== session) changed = true;
          return updated;
        });
        if (changed) { current.registry.current = next; current.publish([...next]); }
      }
    });
    coordinator.current = owner;
    return () => { owner.dispose(); for (const request of explicitRequests.current.values()) request.abort(); explicitRequests.current.clear(); };
  }, [input.scope]);
  useEffect(() => {
    if (!input.ready) return;
    if (!historyBaseline.current.captured) {
      // Loading persisted conversations must never send their text to a model as a side effect.
      // Include lazy history indexes so opening an older session cannot bypass this boundary.
      for (const session of input.registry.current) {
        if (session.messages.length || session.messageCount || session.messagesLoaded === false) historyBaseline.current.ids.add(session.id);
      }
      historyBaseline.current.captured = true;
    }
    coordinator.current?.reconcile();
  }, [input.ready, input.sessions, input.scope]);
  return useCallback(async (id: string) => {
    if (explicitRequests.current.has(id)) return;
    const controller = new AbortController();
    explicitRequests.current.set(id, controller);
    try {
      await renameAssistantSessionWithAI(id, {
        getSessions: () => latest.current.registry.current,
        getScope: () => latest.current.scope,
        getGeneration: getAccountSessionGeneration,
        loadSession: target => latest.current.loadSession?.(target) ?? Promise.resolve(undefined),
        generate: (turn, signal) => {
          const settings = latest.current.getSettings();
          return generateSessionTitle(turn, createModelGatewayFromSettings(settings, { cloudTransport: latest.current.modelTransport }),
            { model: getModelForSettings(settings), provider: getActiveModelProvider(settings) }, signal);
        },
        update: (target, change) => {
          const current = latest.current;
          const next = current.registry.current.map(session => session.id === target ? change(session) : session);
          current.registry.current = next; current.publish([...next]);
        }
      }, controller.signal);
    } finally { if (explicitRequests.current.get(id) === controller) explicitRequests.current.delete(id); }
  }, []);
}
