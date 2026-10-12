import { createAssistantStore } from "../../features/assistant/assistant.store";
import type { FrontendAgentClient } from "../../features/agent-api/frontendAgentClient";
import type { AgentEvent } from "../../features/agent-api/agentApi.types";

export type OwnedAssistantRun = {
  cancelRequested: boolean;
  cancelSent: boolean;
  client: FrontendAgentClient;
  activityMessageId: string;
  message: string;
  runId?: string;
};

/** Application owner. A view selection never changes an executing run's target. */
export function createAssistantSessionService(initialTarget: string) {
  const stores = new Map<string, ReturnType<typeof createAssistantStore>>();
  const dispatchingMessages = new Map<string, string>();
  const runs = new Map<string, OwnedAssistantRun>();
  const queues = new Map<string, unknown[]>();
  const inboxes = new Map<string, { sequence: number; pending: Map<number, AgentEvent>; ids: Map<string, string> }>();
  let activeTarget = initialTarget;
  let routingTarget: string | undefined;
  let disposed = false;
  const target = () => routingTarget ?? activeTarget;
  const store = (id = target()) => {
    let value = stores.get(id);
    if (!value) { value = createAssistantStore(); stores.set(id, value); }
    return value;
  };
  return {
    target, store, runs, dispatchingMessages,
    select(id: string) { activeTarget = id; },
    queue<T>(id = target()): T[] {
      if (!queues.has(id)) queues.set(id, []);
      return queues.get(id)! as T[];
    },
    replaceQueue(value: unknown[], id = target()) { queues.set(id, value); },
    withTarget<T>(id: string, callback: () => T): T | undefined {
      if (disposed) return undefined;
      const previous = routingTarget;
      routingTarget = id;
      try { return callback(); } finally { routingTarget = previous; }
    },
    accept(event: AgentEvent, apply: (event: AgentEvent) => void) {
      if (disposed) return;
      if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) throw new Error("运行事件序号无效。");
      const inbox = inboxes.get(event.runId) ?? { sequence: 0, pending: new Map(), ids: new Map() };
      inboxes.set(event.runId, inbox);
      const serialized = JSON.stringify(event);
      const seen = inbox.ids.get(event.eventId);
      if (seen && seen !== serialized) throw new Error("运行事件身份冲突，已保留已有内容。");
      if (seen || event.sequence <= inbox.sequence) return;
      if (inbox.pending.has(event.sequence)) throw new Error("运行事件序号冲突。");
      inbox.ids.set(event.eventId, serialized);
      inbox.pending.set(event.sequence, event);
      while (inbox.pending.has(inbox.sequence + 1)) {
        const next = inbox.pending.get(inbox.sequence + 1)!;
        apply(next);
        inbox.pending.delete(++inbox.sequence);
      }
    },
    watermark(runId: string) { return inboxes.get(runId)?.sequence ?? 0; },
    hasGap(runId: string) { return !!inboxes.get(runId)?.pending.size; },
    activate() { disposed = false; },
    dispose() { disposed = true; },
    get disposed() { return disposed; }
  };
}
