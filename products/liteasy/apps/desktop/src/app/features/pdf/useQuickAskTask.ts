import { useEffect, useReducer, useRef } from "react";

export type QuickAskPhase = "ready" | "preparing" | "streaming" | "completed_unsaved" | "saved" | "failed" | "interrupted" | "save_failed";
export type QuickAskTaskDraft<S, R> = {
  selection: S | null;
  instruction: string;
  preference?: string;
  open: boolean;
  phase: QuickAskPhase;
  text: string;
  error: string;
  result?: R;
  attemptId?: string;
};
const initial = <S, R>(): QuickAskTaskDraft<S, R> => ({ selection: null, instruction: "", open: false, phase: "ready", text: "", error: "" });

/** The reading task owns its run; hiding its surface never aborts generation. */
export function useQuickAskTask<S, R>(scope: string) {
  const drafts = useRef(new Map<string, QuickAskTaskDraft<S, R>>());
  const [, render] = useReducer((n: number) => n + 1, 0);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const run = useRef<{ scope: string; abort: AbortController; attemptId: string }>();
  if (!drafts.current.has(scope)) drafts.current.set(scope, initial());
  const draft = drafts.current.get(scope)!;
  function update(patch: Partial<QuickAskTaskDraft<S, R>>, target = scope) {
    const value = drafts.current.get(target);
    if (!value) return;
    Object.assign(value, patch);
    render();
  }
  function stop() {
    const active = run.current;
    if (!active) return;
    active.abort.abort();
    run.current = undefined;
    update({ phase: "interrupted", error: "本次回答没有完成，已保留你的问题和选段。" }, active.scope);
  }
  useEffect(() => {
    if (run.current && run.current.scope !== scope) stop();
    // Retain old-document drafts in this reader; never retain drafts across account switches.
    const account = scope.split("\u0000")[0];
    for (const key of drafts.current.keys()) if (key.split("\u0000")[0] !== account) drafts.current.delete(key);
  }, [scope]);
  useEffect(() => () => { run.current?.abort.abort(); run.current = undefined; }, []);
  async function save(result: R, persist: (result: R) => Promise<void>, target: string, attemptId?: string) {
    const stillCurrent = () => currentScope.current === target && drafts.current.get(target)?.attemptId === attemptId;
    if (!stillCurrent()) return;
    update({ phase: "completed_unsaved", error: "" }, target);
    try {
      await persist(result);
      if (stillCurrent()) update({ phase: "saved", error: "" }, target);
    } catch (error) {
      if (stillCurrent()) update({ phase: "save_failed", error: error instanceof Error ? error.message : "批注保存失败，请重试保存。" }, target);
    }
  }
  async function start(generate: (signal: AbortSignal, onDelta: (text: string) => void, attemptId: string) => Promise<{ text: string; result: R }>, persist: (result: R) => Promise<void>) {
    if (run.current) return;
    const active = { scope, abort: new AbortController(), attemptId: crypto.randomUUID() };
    run.current = active;
    update({ phase: "preparing", text: "", error: "", result: undefined, attemptId: active.attemptId });
    const valid = () => run.current === active && !active.abort.signal.aborted && currentScope.current === scope;
    try {
      const output = await generate(active.abort.signal, (text) => { if (valid()) update({ text, phase: "streaming" }); }, active.attemptId);
      if (!valid()) return;
      if (!output.text.trim()) throw new Error("没有收到回答，请重试。");
      update({ text: output.text, result: output.result, phase: "completed_unsaved" });
      await save(output.result, persist, scope, active.attemptId);
    } catch (error) {
      if (valid()) update({ phase: "failed", error: error instanceof Error ? error.message : "本次回答没有完成，已保留你的问题和选段。" });
    } finally {
      if (run.current === active) run.current = undefined;
    }
  }
  return {
    draft, update, start, stop,
    busy: draft.phase === "preparing" || draft.phase === "streaming" || draft.phase === "completed_unsaved",
    open(selection: S, instruction = "") {
      if (run.current) { update({ open: true }); return; }
      update({ ...initial<S, R>(), selection, instruction, open: true });
    },
    close() { update({ open: false }); },
    discard() { stop(); update(initial()); },
    retrySave(persist: (result: R) => Promise<void>) {
      if (draft.result !== undefined && draft.phase === "save_failed") return save(draft.result, persist, scope, draft.attemptId);
      return Promise.resolve();
    }
  };
}
