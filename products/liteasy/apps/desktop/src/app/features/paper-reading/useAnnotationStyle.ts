import { useEffect, useMemo, useRef, useState } from "react";
import { createNoteFileService, type NoteFileSnapshot } from "../note-files/noteFileService";
import type { Paper } from "../workspace/workspace.types";
import type { SettingsState } from "../settings/settings.types";
import type { ModelTransport } from "../models/modelHttpClient";
import { collectAnnotationStyleSamples, learnAnnotationStyle, validateAnnotationStyle } from "./annotationStyle";

type StyleFile = { mountId: string; path: string; enabled: boolean };
function readStyleFile(key: string): StyleFile | undefined {
  const raw = localStorage.getItem(key);
  if (!raw) return undefined;
  const value = JSON.parse(raw) as StyleFile;
  if (!value || typeof value.mountId !== "string" || typeof value.path !== "string" || typeof value.enabled !== "boolean") {
    throw new Error("风格文件记录无效，请重新选择文件。");
  }
  return value;
}

export function useAnnotationStyle(input: {
  scopeId: string; sessionGeneration: string | number; getPapers(): Paper[]; getSettings(): SettingsState; transport?: ModelTransport;
}) {
  const latest = useRef(input); latest.current = input;
  const lifetime = useMemo(() => ({}), [input.scopeId, input.sessionGeneration]);
  const currentLifetime = useRef<object | null>(lifetime); currentLifetime.current = lifetime;
  const files = useMemo(() => createNoteFileService(input.scopeId, () => latest.current.scopeId), [input.scopeId]);
  const key = `liteasy.annotation-style.v1:${input.scopeId}`;
  const running = useRef<AbortController>();
  const [binding, setBinding] = useState<StyleFile>();
  const [file, setFile] = useState<NoteFileSnapshot>();
  const [draft, setDraft] = useState("");
  const [learning, setLearning] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const checkLifetime = () => {
    if (currentLifetime.current !== lifetime) throw new DOMException("账号已切换", "AbortError");
  };
  async function execute(action: (check: () => void, signal: AbortSignal) => Promise<void>, canCancel = false) {
    if (running.current) return;
    const controller = new AbortController(); running.current = controller;
    const check = () => { controller.signal.throwIfAborted(); checkLifetime(); };
    setBusy(true); setLearning(canCancel); setError(""); setMessage("");
    try { check(); await action(check, controller.signal); }
    catch (failure) {
      if (currentLifetime.current === lifetime && (!controller.signal.aborted || controller.signal.reason?.name !== "AbortError")) {
        const cause = controller.signal.aborted ? controller.signal.reason : failure;
        setMessage("");
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (running.current === controller) { running.current = undefined; setBusy(false); setLearning(false); }
    }
  }
  const remember = (value: StyleFile) => {
    checkLifetime(); localStorage.setItem(key, JSON.stringify(value)); setBinding(value);
  };
  useEffect(() => {
    currentLifetime.current = lifetime;
    setBinding(undefined); setFile(undefined); setDraft("");
    void execute(async check => {
      const saved = readStyleFile(key); setBinding(saved);
      if (!saved) return;
      const snapshot = await files.readFile(saved.mountId, saved.path); check();
      setFile(snapshot); setDraft(validateAnnotationStyle(snapshot.text));
    });
    return () => { currentLifetime.current = null; running.current?.abort(); running.current = undefined; };
  }, [lifetime, files, key]);

  return {
    busy, learning, error, message, draft, enabled: binding?.enabled ?? false, fileName: file?.name ?? binding?.path,
    dirty: draft.trim() !== (file?.text.trim() ?? ""),
    setDraft: (value: string) => { if (!running.current) setDraft(value); },
    cancel: () => { if (learning) { running.current?.abort(); setMessage("已停止学习，原风格文件保持不变。"); } },
    learn: () => execute(async (check, signal) => {
      const request = latest.current;
      const settings = request.getSettings();
      setMessage("正在读取个人文献中的手动批注…");
      const { samples, unavailable } = await collectAnnotationStyleSamples(request.getPapers(), check); check();
      setMessage(`正在从 ${samples.length} 条手动批注学习风格…`);
      const operation = running.current;
      const timeout = setTimeout(() => operation?.abort(new Error("风格学习超时，请重试。")), 90_000);
      try {
        const text = await learnAnnotationStyle({ samples, settings, transport: request.transport, signal }); check();
        setDraft(text);
        setMessage(`已从 ${new Set(samples.map(sample => sample.paper)).size} 篇文献的 ${samples.length} 条手动批注生成草稿，请保存风格文件后使用。${unavailable ? `另有 ${unavailable} 篇文献的批注无法读取。` : ""}`);
      } finally { clearTimeout(timeout); }
    }, true),
    save: () => execute(async check => {
      const text = validateAnnotationStyle(draft);
      const target = file ?? await files.chooseFile({ mode: "save", extension: "md", suggestedName: "annotation-style.md" }); check();
      if (!target) return;
      const saved = await files.writeFile({ mountId: target.mountId, path: target.path, text: `${text}\n`, expectedVersion: target.version }); check();
      setFile(saved); setDraft(text); remember({ mountId: saved.mountId, path: saved.path, enabled: true });
      setMessage("风格文件已保存并启用，后续 AI 标注会读取此文件。");
    }),
    select: () => execute(async check => {
      const selected = await files.chooseFile({ mode: "open", extension: "md" }); check();
      if (!selected) return;
      const text = validateAnnotationStyle(selected.text);
      remember({ mountId: selected.mountId, path: selected.path, enabled: true }); setFile(selected); setDraft(text);
      setMessage("已启用所选风格文件。");
    }),
    reload: () => execute(async check => {
      if (!binding) return;
      const snapshot = await files.readFile(binding.mountId, binding.path); check();
      const text = validateAnnotationStyle(snapshot.text); setFile(snapshot); setDraft(text); setMessage("已重新读取风格文件。");
    }),
    setEnabled: (enabled: boolean) => {
      if (!binding || running.current) return;
      try { remember({ ...binding, enabled }); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    },
    async readForGeneration() {
      checkLifetime();
      const saved = readStyleFile(key);
      if (!saved?.enabled) return "";
      try {
        const snapshot = await files.readFile(saved.mountId, saved.path); checkLifetime();
        return validateAnnotationStyle(snapshot.text);
      } catch (failure) {
        checkLifetime();
        throw new Error(`无法读取已启用的风格文件，请重新选择文件或关闭个人批注风格：${failure instanceof Error ? failure.message : String(failure)}`);
      }
    },
  };
}

export type AnnotationStyleController = ReturnType<typeof useAnnotationStyle>;
