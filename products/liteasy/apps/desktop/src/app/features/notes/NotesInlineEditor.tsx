import { useEffect, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { useMarkdownEditing } from "../markdown/MarkdownEditingContext";
import { useMarkdownAutosave } from "../markdown/useMarkdownAutosave";
import { visualEditorDrafts } from "../visual-blocks/visualEditorDrafts";
import type { NotesItem, NotesViewModel } from "./notes.types";

export function NotesInlineEditor({ item, model, path }: { item: NotesItem; model: NotesViewModel; path: string }) {
  const preference = useMarkdownEditing();
  const revision = String(item.object?.revision ?? item.file?.version ?? "");
  const [initial] = useState(() => visualEditorDrafts.get(path));
  const [draft, setDraft] = useState(initial?.text ?? item.text), [saved, setSaved] = useState(item.text);
  const [error, setError] = useState(initial && initial.revision !== revision ? "源笔记已经改变，草稿已保留。请复制草稿后重新载入合并。" : "");
  const [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  const saving = useRef(false), current = useRef({ item, draft, revision }); current.current = { item, draft, revision };
  useEffect(() => {
    if (saving.current || item.text === saved) return;
    if (draft === saved) { setDraft(item.text); setSaved(item.text); }
    else setError("源笔记已经改变，草稿已保留。请复制草稿后重新载入合并。");
  }, [item.text, revision, saved, draft]);
  function change(text: string) {
    setDraft(text);
    try { visualEditorDrafts.save(path, { text, revision }); } catch (e) { setError(String(e)); }
  }
  async function save() {
    if (saving.current || error) return;
    const snapshot = current.current;
    saving.current = true; setBusy(true);
    try {
      await model.editNote(snapshot.item, snapshot.draft);
      setSaved(snapshot.draft);
      if (current.current.draft === snapshot.draft) visualEditorDrafts.remove(path);
      else visualEditorDrafts.save(path, { text: current.current.draft, revision: current.current.revision });
    } catch (e) { setError(`${String(e)}。草稿仍保留。`); }
    finally { saving.current = false; setBusy(false); }
  }
  const failure = useMarkdownAutosave({ identity: path, value: draft, saved, enabled: preference.mode === "live" && preference.autosave, busy, blocked: Boolean(error), save });
  return <div className="notes-inline-editor" onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); } }}>
    <MarkdownEditor documentKey={path} label="笔记正文" value={draft} onChange={change} previewProps={{ paperAnchors: item.paperAnchors ?? item.object?.paperAnchors }} />
    <div className="notes-item-actions"><span role="status" className="markdown-save-status">{busy ? "正在保存…" : error || failure ? "自动保存已暂停 · 草稿保留" : saved === draft ? "已保存" : preference.autosave ? "等待自动保存…" : "未保存"}</span>
      <Button size="small" disabled={busy || Boolean(error) || draft === saved} onClick={() => void save()}>保存</Button>
      {error || failure ? <Button size="small" onClick={() => setConfirm(true)}>重新载入</Button> : null}</div>
    {error || failure ? <p role="alert">{error || failure}</p> : null}
    {confirm ? <div><p>重新载入会放弃此处草稿，请先复制需要保留的内容。</p><Button onClick={() => { visualEditorDrafts.remove(path); setDraft(item.text); setSaved(item.text); setError(""); setConfirm(false); }}>放弃修改并载入</Button><Button onClick={() => setConfirm(false)}>保留草稿</Button></div> : null}
  </div>;
}
