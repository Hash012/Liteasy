import { useCallback, useEffect, useRef, useState } from "react";
import { taskClient, type TaskSnapshot, type RemoteTask, type TaskKind } from "../features/tasks/taskClient";
import { hasNativeHost } from "../platform/native";
import type { LibraryItem } from "../features/library/library.types";

const empty: TaskSnapshot = { devices: [], pairs: [], tasks: [], outbox: [] };
export function useTasksController(scope: string) {
  const [snapshot, setSnapshot] = useState(empty);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const active = useRef(scope); active.current = scope;
  const loaded = useRef(scope);
  const available = scope !== "local" && hasNativeHost();
  const refresh = useCallback(async () => { if (!available) return; const value = await taskClient.snapshot(scope); if (active.current === scope) { loaded.current = scope; setSnapshot(value); } }, [scope, available]);
  useEffect(() => {
    active.current = scope; setSnapshot(empty); setError(""); setBusy(false); let live = true; let polling = false;
    const check = async () => {
      if (!live || polling || document.visibilityState === "hidden" || !available) return;
      polling = true;
      try { await refresh(); } catch (reason) { if (live && active.current === scope) setError(String(reason)); } finally { polling = false; }
    };
    void check(); const timer = setInterval(() => void check(), 5000);
    return () => { live = false; active.current = ""; clearInterval(timer); };
  }, [available, refresh, scope]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await action(); await refresh(); }
    catch (reason) { if (active.current === scope) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (active.current === scope) setBusy(false); }
  };
  return { snapshot: loaded.current === scope ? snapshot : empty, available, error, busy, pair: (code: string) => run(() => taskClient.pair(scope, code)),
    loadResult: async (task: RemoteTask) => { const result = await taskClient.result(scope, task); if (active.current !== scope) throw new Error("账号已切换。"); return result; },
    unpair: (id: string) => run(() => taskClient.unpair(scope, id)), cancel: (task: RemoteTask) => run(() => taskClient.cancel(scope, task)),
    retry: () => run(() => taskClient.retry(scope)),
    enqueue: (desktopId: string, kind: TaskKind, item?: LibraryItem) => run(() => taskClient.enqueue(scope, { operationId: crypto.randomUUID(), desktopId, kind,
      ...(item && kind !== "sync-library" ? { document: { documentId: item.id, contentHash: item.contentHash, title: item.title } } : {}) })) };
}
