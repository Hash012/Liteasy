import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { communityStorageChanged, draftRecords, loadDraft, removeDraftRevision, saveDraft, saveDraftRevision, type LocalDraft } from "./communityPersistence";

export type LocalDraftController<T> = {
  draftId: string; localRevision: number; drafts: LocalDraft<T>[]; status: string;
  save: () => Promise<LocalDraft<T>>; clear: (snapshot: LocalDraft<T>) => Promise<boolean>; restore: (draftId: string) => void;
};
export function useLocalDraft<T>({ owner, scope, value, onRestore, initialDraftId, enabled = true }: {
  owner: string; scope: string; value: T; onRestore: (value: T) => void; initialDraftId?: string; enabled?: boolean;
}): LocalDraftController<T> {
  const [status, setStatus] = useState("");
  const [drafts, setDrafts] = useState<LocalDraft<T>[]>([]);
  const [, redraw] = useState(0);
  const restoreCallback = useRef(onRestore); restoreCallback.current = onRestore;
  const serialized = JSON.stringify(value);
  const session = useMemo(() => ({ owner, scope, draftId: initialDraftId ?? crypto.randomUUID(), localRevision: 0,
    writerId: crypto.randomUUID(), latest: value, initial: JSON.stringify(value), saved: "", active: true,
    queue: Promise.resolve(), conflict: false, epoch: 0, enabled }), [owner, scope, initialDraftId]);
  session.latest = value; session.enabled = enabled;
  const refresh = useCallback(() => {
    try { if (session.active) setDrafts(draftRecords<T>(owner, scope)); }
    catch { if (session.active) setStatus("无法读取本机草稿，请保留此窗口。"); }
  }, [owner, scope, session]);
  const save = useCallback((): Promise<LocalDraft<T>> => {
    const snapshot = JSON.parse(JSON.stringify(session.latest)) as T;
    const epoch = session.epoch;
    const originalTarget = { draftId: session.draftId, expectedRevision: session.localRevision, writerId: session.writerId };
    const work = session.queue.catch(() => {}).then(async () => {
      const saved = await saveDraftRevision(owner, scope, snapshot, session.epoch === epoch ? { draftId: session.draftId, expectedRevision: session.localRevision, writerId: session.writerId } : originalTarget);
      if (session.epoch !== epoch) { refresh(); return saved; }
      session.draftId = saved.draftId; session.localRevision = saved.localRevision; session.saved = JSON.stringify(snapshot);
      session.conflict ||= Boolean(saved.conflictOf);
      if (session.active) {
        setStatus(session.conflict ? "检测到另一窗口的修改，已将你的内容保存为独立冲突草稿；两份内容都已保留。" : "草稿已保存到此浏览器，仅当前账号可恢复。");
        redraw((version) => version + 1); refresh();
      }
      return saved;
    });
    session.queue = work.then(() => {}, () => {});
    return work.catch((error) => {
      if (session.active) setStatus(error instanceof Error ? error.message : "草稿尚未保存，请保留此窗口。");
      throw error;
    });
  }, [owner, scope, session, refresh]);
  const restore = useCallback((draftId: string) => {
    try {
      const saved = loadDraft<T>(owner, scope, draftId);
      if (!saved) throw new Error("这份草稿已变化，请重新选择。");
      restoreCallback.current(saved.value);
      session.epoch += 1;
      session.draftId = saved.draftId; session.localRevision = saved.localRevision; session.saved = JSON.stringify(saved.value);
      session.initial = session.saved; session.conflict = Boolean(saved.conflictOf);
      setStatus("已恢复本机草稿，请重新检查后预览；不会自动发送。"); redraw((version) => version + 1);
    } catch (error) { setStatus(error instanceof Error ? error.message : "无法恢复本机草稿。"); }
  }, [owner, scope, session]);
  useEffect(() => {
    session.active = true; setStatus(""); refresh();
    if (initialDraftId) restore(initialDraftId);
    const refreshFromStorage = () => refresh();
    window.addEventListener("storage", refreshFromStorage);
    window.addEventListener(communityStorageChanged, refreshFromStorage);
    // Page close cannot await Web Locks. Preserve pending bytes as a NEW recovery
    // branch synchronously rather than racing another window's existing revision.
    const saveOnExit = () => {
      const latest = JSON.stringify(session.latest);
      if (!owner || !session.enabled || latest === (session.saved || session.initial)) return;
      try {
        const rescued = saveDraft(owner, scope, session.latest);
        session.epoch += 1;
        session.saved = latest; session.draftId = rescued.draftId; session.localRevision = rescued.localRevision;
      } catch { /* beforeunload keeps an unsaved-changes warning when persistence failed. */ }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      saveOnExit();
      if (JSON.stringify(session.latest) !== (session.saved || session.initial)) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload); window.addEventListener("pagehide", saveOnExit);
    return () => {
      session.active = false;
      window.removeEventListener("storage", refreshFromStorage); window.removeEventListener(communityStorageChanged, refreshFromStorage);
      window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("pagehide", saveOnExit);
      saveOnExit();
    };
  }, [owner, scope, session, refresh, restore, initialDraftId]);
  useEffect(() => {
    if (!owner || !enabled || serialized === (session.saved || session.initial)) return;
    setStatus("当前修改尚未保存到浏览器。");
    const timer = window.setTimeout(() => {
      if (JSON.stringify(session.latest) !== (session.saved || session.initial)) void save().catch(() => {});
    }, 350);
    return () => window.clearTimeout(timer);
  }, [owner, enabled, serialized, session, save]);
  const clear = useCallback(async (snapshot: LocalDraft<T>) => {
    const removed = await removeDraftRevision(owner, scope, snapshot);
    if (removed && session.draftId === snapshot.draftId && session.localRevision === snapshot.localRevision) {
      // Remote completion only covers the submitted snapshot, never keystrokes
      // typed while the network request was in flight. New work gets a new draft.
      const submitted = JSON.stringify(snapshot.value);
      const dirty = JSON.stringify(session.latest) !== submitted;
      session.epoch += 1; session.draftId = crypto.randomUUID(); session.localRevision = 0;
      session.saved = dirty ? "" : submitted; session.initial = submitted;
      if (session.active) setStatus(dirty ? "当前修改尚未保存到浏览器。" : "");
    }
    refresh(); return removed;
  }, [owner, scope, session, refresh]);
  const displayedStatus = status.startsWith("草稿已保存") && session.saved !== serialized ? "当前修改尚未保存到浏览器。" : status;
  return { draftId: session.draftId, localRevision: session.localRevision, drafts, status: displayedStatus, save, clear, restore };
}
