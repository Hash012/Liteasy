import { createNotesRepository } from "../features/notes/notesRepository";
import { createObjectStorage } from "../features/objects/objectStorage";
import { notifyNotesSourcesChanged } from "../features/notes/notesPort";
import { useMarkdownAutosave } from "../features/markdown/useMarkdownAutosave";
import { useEffect, useMemo, useRef, useState } from "react";
import { createNoteFileService, type NoteFileSnapshot } from "../features/note-files/noteFileService";
import type { ExternalEditingStatus } from "../features/note-files/obsidianWorkspace";

type NoteSession = { snapshot: NoteFileSnapshot; draft: string; editing: boolean; changed: boolean };
const keyOf = (file: NoteFileSnapshot) => `${file.mountId}\0${file.path}`;

/** Keep only the active file and unsaved drafts. Directory browsing never loads bodies. */
export function useExternalNoteController(input: { scopeId: string; visible: boolean; autosave?: boolean; onOpen(): void }) {
  const latest = useRef(input); latest.current = input;
  const files = useMemo(() => createNoteFileService(input.scopeId, () => latest.current.scopeId), [input.scopeId]);
  const notes = useMemo(() => createNotesRepository(createObjectStorage(input.scopeId, () => latest.current.scopeId)), [input.scopeId]);
  const [session, setSession] = useState<NoteSession>();
  const current = useRef(session); current.current = session;
  const drafts = useRef(new Map<string, NoteSession>());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusyState] = useState(false);
  const busyRef = useRef(false);
  const setBusy = (value: boolean) => { busyRef.current = value; setBusyState(value); };
  const [status, setStatus] = useState<ExternalEditingStatus>();
  const scope = input.scopeId;
  const generation = useRef(0);
  const alive = useRef(true);
  const valid = () => alive.current && latest.current.scopeId === scope;
  function replace(next: NoteSession | undefined) { current.current = next; setSession(next); }
  useEffect(() => {
    alive.current = true;
    generation.current++;
    drafts.current.clear(); replace(undefined); setError(""); setStatus(undefined); setBusy(false);
    return () => { alive.current = false; generation.current++; };
  }, [scope]);

  useEffect(() => {
    if (!input.visible || !session) return;
    let cancelled = false;
    let checking = false;
    const file = session.snapshot;
    const check = async () => {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      const checkedVersion = current.current?.snapshot.version;
      const [disk, editor] = await Promise.allSettled([
        files.readFile(file.mountId, file.path), files.editingStatus?.(file.mountId, file.path),
      ]);
      checking = false;
      if (cancelled || !valid() || !current.current || keyOf(current.current.snapshot) !== keyOf(file)) return;
      if (editor.status === "fulfilled") setStatus(editor.value);
      const active = current.current;
      // A poll started before a save must not roll the just-saved file back in the UI.
      if (active.snapshot.version !== checkedVersion) return;
      if (disk.status === "fulfilled" && disk.value.version !== active.snapshot.version) {
        if (active.draft === active.snapshot.text) {
          replace({ ...active, snapshot: disk.value, draft: disk.value.text, changed: false });
          setNotice("已载入其他应用保存的最新内容。");
        } else replace({ ...active, changed: true });
      } else if (disk.status === "rejected") setNotice("暂时无法检查磁盘文件；当前草稿仍保留。保存时会再次核对版本。");
    };
    void check();
    const timer = setInterval(() => void check(), 8000);
    window.addEventListener("focus", check);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener("focus", check); };
  }, [files, input.visible, session?.snapshot.mountId, session?.snapshot.path]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (drafts.current.size || current.current && current.current.draft !== current.current.snapshot.text) {
        event.preventDefault(); event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  async function save(copy = false) {
    const active = current.current;
    if (!active || busyRef.current) return;
    const operation = generation.current;
    const text = active.draft;
    setBusy(true); setError("");
    try {
      const file = active.snapshot;
      const path = copy ? file.path.replace(/\.(md|markdown)$/i, ` (Liteasy ${Date.now()}).md`) : file.path;
      const saved = await files.writeFile({ mountId: file.mountId, path, text, expectedVersion: copy ? null : file.version });
      if (!valid() || operation !== generation.current) return;
      drafts.current.delete(keyOf(file));
      replace({ snapshot: saved, draft: current.current?.draft ?? text, changed: false, editing: current.current?.editing ?? active.editing });
      setNotice(copy ? "草稿已另存为副本，原文件保持不变。" : "已保存到原文件。");
      if (text !== file.text) {
        // Metadata must not hold the disk-write lock or delay the next autosave.
        void notes.setLabel({ kind: "external-file", mountId: file.mountId, path }, "user-edited", true)
          .then(() => { if (valid()) notifyNotesSourcesChanged(); })
          .catch(() => {
            if (valid() && operation === generation.current) setNotice("正文已保存；编辑痕迹标签暂未保存，可在笔记操作中补充。");
          });
      }
    } catch (failure) {
      if (valid() && operation === generation.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally { if (valid() && operation === generation.current) setBusy(false); }
  }

  useMarkdownAutosave({ identity: session ? `${scope}:${keyOf(session.snapshot)}` : undefined,
    value: session?.draft, saved: session?.snapshot.text, enabled: Boolean(input.autosave), busy,
    blocked: Boolean(error || session?.changed || status?.editing), save });

  return {
    session, error, notice, busy, status,
    drafts: [...drafts.current.values()].filter((entry) => keyOf(entry.snapshot) !== (session && keyOf(session.snapshot))).map((entry) => entry.snapshot),
    open(file: NoteFileSnapshot) {
      if (!valid()) return;
      if (busyRef.current) throw new Error("正在保存，请稍后打开其他文件。");
      const active = current.current;
      if (active && active.draft !== active.snapshot.text) drafts.current.set(keyOf(active.snapshot), active);
      else if (active) drafts.current.delete(keyOf(active.snapshot));
      const retained = [...drafts.current.values()].reduce((bytes, entry) => bytes + entry.draft.length * 2, 0);
      if (!drafts.current.has(keyOf(file)) && (drafts.current.size >= 8 || retained > 16 * 1024 * 1024))
        throw new Error("有较多未保存的草稿，请先保存后再打开其他文件。");
      generation.current++;
      const previous = drafts.current.get(keyOf(file));
      replace(previous ? { ...previous, changed: previous.snapshot.version !== file.version } : { snapshot: file, draft: file.text, editing: false, changed: false });
      setStatus(undefined); setError(""); setNotice(""); input.onOpen();
    },
    setDraft(text: string) { if (current.current) replace({ ...current.current, draft: text }); },
    setEditing(editing: boolean) { if (current.current) replace({ ...current.current, editing }); },
    save,
    async reload() {
      const active = current.current;
      if (!active || busyRef.current) return;
      const operation = generation.current;
      setBusy(true); setError("");
      try {
        const file = await files.readFile(active.snapshot.mountId, active.snapshot.path);
        if (!valid() || operation !== generation.current) return;
        if (current.current?.draft !== active.draft) throw new Error("载入期间草稿发生了变化，已保留修改。请再次选择重新载入。");
        drafts.current.delete(keyOf(file)); replace({ ...active, snapshot: file, draft: file.text, changed: false });
        setNotice("已重新载入磁盘版本。");
      } catch (failure) { if (valid()) setError(String(failure)); }
      finally { if (valid() && operation === generation.current) setBusy(false); }
    },
  };
}
