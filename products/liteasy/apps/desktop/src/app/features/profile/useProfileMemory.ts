import { useEffect, useRef, useState } from "react";
import { emptyProfileMemory, loadProfileMemory, memoryFingerprint, profileMemoryEvent, saveProfileMemory, type MemoryField, type ProfileMemory } from "./profileMemory";
import { applyMemoryProposals, memoryCandidateSentences, memoryCheckDue, memoryCurationPrompt, memoryOutputFormat, reserveMemoryCheck } from "./profileMemoryCurator";
export type ProfileMemoryGenerator = (input: { prompt: string; signal: AbortSignal; outputFormat: typeof memoryOutputFormat }) => Promise<string>;
export type CompletedProfileTurn = { message: string; sessionId: string; requestId: string };
export function useProfileMemory(input: { scope: string; enabled: boolean; generate?: ProfileMemoryGenerator }) {
  const latest = useRef(input); latest.current = input;
  const [state, setState] = useState(() => ({ scope: input.scope, ...loadProfileMemory(input.scope) }));
  const [notice, setNotice] = useState("");
  const busy = useRef<AbortController>();
  const queue = useRef<Array<{ sessionId: string; sentence: string }>>([]);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const refresh = () => setState({ scope: input.scope, ...loadProfileMemory(input.scope) });
    refresh(); setNotice(""); seen.current.clear(); queue.current = [];
    window.addEventListener(profileMemoryEvent, refresh);
    window.addEventListener("storage", refresh);
    return () => { busy.current?.abort(); busy.current = undefined; queue.current = [];
      window.removeEventListener(profileMemoryEvent, refresh); window.removeEventListener("storage", refresh); };
  }, [input.scope, input.enabled]);
  const snapshot = state.scope === input.scope ? state : { scope: input.scope, ...loadProfileMemory(input.scope) };
  function change(transform: (data: ProfileMemory) => ProfileMemory, message?: string) {
    try {
      const current = loadProfileMemory(input.scope);
      if (current.error) throw new Error(current.error);
      const next = saveProfileMemory(input.scope, transform(current.data), current.data.revision);
      if (!next.automatic) { busy.current?.abort(); queue.current = []; }
      if (message) setNotice(message);
      return true;
    } catch (error) { setNotice(error instanceof Error ? error.message : "本机画像保存失败。"); return false; }
  }
  async function observeTurn(turn: CompletedProfileTurn) {
    const scope = input.scope;
    if (latest.current.scope !== scope || !latest.current.enabled || !latest.current.generate || seen.current.has(turn.requestId)) return;
    seen.current.add(turn.requestId);
    if (seen.current.size > 200) seen.current.delete(seen.current.values().next().value!);
    const initial = loadProfileMemory(scope);
    if (initial.error || !initial.data.automatic) return;
    queue.current.push(...memoryCandidateSentences(turn.message).map((sentence) => ({ sessionId: turn.sessionId, sentence })));
    queue.current = queue.current.slice(-8);
    try {
      let current = saveProfileMemory(scope, { ...initial.data, cadence: { ...initial.data.cadence, turns: initial.data.cadence.turns + 1 } }, initial.data.revision);
      const sentences = [...new Set(queue.current.filter((item) => item.sessionId === turn.sessionId).map((item) => item.sentence))].slice(-4);
      if (busy.current || !sentences.length || !memoryCheckDue(current, turn.sessionId, Date.now())) return;
      current = saveProfileMemory(scope, reserveMemoryCheck(current, turn.sessionId, Date.now()), current.revision);
      queue.current = queue.current.filter((item) => item.sessionId !== turn.sessionId);
      const controller = new AbortController(); busy.current = controller;
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const answer = await latest.current.generate({ prompt: memoryCurationPrompt(sentences, current), signal: controller.signal, outputFormat: memoryOutputFormat });
        if (controller.signal.aborted || latest.current.scope !== scope || !latest.current.enabled) return;
        const fresh = loadProfileMemory(scope);
        if (fresh.error || !fresh.data.automatic || fresh.data.revision !== current.revision) return;
        const result = applyMemoryProposals(fresh.data, answer, sentences, turn.sessionId, Date.now());
        if (result.saved || result.pending) {
          saveProfileMemory(scope, result.data, fresh.data.revision);
          setNotice([result.saved ? `已从对话记住 ${result.saved} 项偏好。` : "", result.pending ? `${result.pending} 项变更待确认。` : ""].join(""));
        }
      } finally { clearTimeout(timer); if (busy.current === controller) busy.current = undefined; }
    } catch { /* Background extraction must never break an answer or fabricate a memory. */ }
  }
  return {
    data: snapshot.data, error: snapshot.error, notice,
    setAutomatic: (automatic: boolean) => change((data) => ({ ...data, automatic }), automatic ? "自动整理已开启。" : "自动整理已暂停，已有偏好仍可使用。"),
    saveEntry: (field: MemoryField, value: string, id?: string) => {
      const trimmed = value.trim();
      if (!trimmed || trimmed.length > 240) { setNotice("请填写 1–240 字的偏好。"); return false; }
      return change((data) => {
        const old = data.entries.find((entry) => entry.id === id);
        if (!old && data.entries.length >= 48) throw new Error("最多保存 48 项偏好，请先整理已有条目。");
        const entry = { id: old?.id ?? crypto.randomUUID(), field, value: trimmed, source: "manual" as const, updatedAt: new Date().toISOString() };
        return { ...data, entries: [...data.entries.filter((item) => item.id !== id), entry],
          pending: data.pending.filter((item) => item.replacesId !== id), blocked: data.blocked.filter((key) => key !== memoryFingerprint(entry)) };
      }, "偏好已保存到本机。");
    },
    removeEntry: (id: string) => change((data) => ({ ...data, entries: data.entries.filter((entry) => entry.id !== id),
      pending: data.pending.filter((entry) => entry.replacesId !== id),
      blocked: [...data.blocked, ...data.entries.filter((entry) => entry.id === id).map(memoryFingerprint)].slice(-100) }), "已删除；自动整理不会恢复相同条目。"),
    review: (id: string, accept: boolean) => change((data) => {
      const entry = data.pending.find((item) => item.id === id);
      if (!entry) return data;
      if (accept && !entry.replacesId && data.entries.length >= 48) throw new Error("画像已满，请先删除不需要的条目。");
      return { ...data, pending: data.pending.filter((item) => item.id !== id),
        entries: accept ? [...data.entries.filter((item) => item.id !== entry.replacesId), { ...entry, source: "manual" as const }] : data.entries,
        blocked: accept ? data.blocked : [...data.blocked, memoryFingerprint(entry)].slice(-100) };
    }, accept ? "已采用新的偏好。" : "已忽略此建议。"),
    clear: () => { busy.current?.abort(); queue.current = []; change(() => ({ ...emptyProfileMemory(), automatic: false }), "本机记忆已清空。"); },
    setRecentState: (recentState: string) => change((data) => ({ ...data, recentState: recentState.slice(0, 1200) })),
    observeTurn
  };
}
export type ProfileMemoryController = ReturnType<typeof useProfileMemory>;
