import { useEffect, useMemo, useState } from "react";
import { Button, Select, Textarea } from "@fluentui/react-components";
import { MarkdownContent } from "../markdown/MarkdownContent";
import { MarkdownFontControl, useMarkdownFontSize } from "../markdown/MarkdownFontControl";
import { textChapters } from "../reading-library/readingTextChapters";
import "../note-files/externalNoteEditor.css";

type Session = { object: { objectId: string; title: string }; draft: string; saved: string };
type Model = { session?: Session; drafts: Session[]; busy: boolean; error: string; save(): Promise<void>; reload(): Promise<void>; select(id: string): void; setDraft(text: string): void };
export function PaperNoteEditor({ model }: { model: Model }) {
  const font = useMarkdownFontSize();
  const [editing, setEditing] = useState(true);
  const [part, setPart] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const note = model.session;
  useEffect(() => { setPart(0); setConfirm(false); }, [note?.object.objectId]);
  const preview = useMemo(() => { try { return { chapters: !editing && note ? textChapters(note.draft, note.object.title, true) : [], error: "" }; }
    catch (failure) { return { chapters: [], error: String(failure) }; } }, [editing, note?.draft]);
  if (!note) return <p>从文献库打开或新建论文笔记。</p>;
  const dirty = note.draft !== note.saved;
  return <section className="external-note-editor" style={font.style} aria-label="论文 Markdown 笔记" onKeyDown={(event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void model.save(); }
  }}><header><strong>{note.object.title}{dirty ? " · 未保存" : ""}</strong>
    <MarkdownFontControl {...font} />
    <Button onClick={() => setEditing(!editing)}>{editing ? "阅读" : "编辑"}</Button>
    <Button appearance="primary" disabled={!dirty || model.busy} onClick={() => void model.save()}>保存</Button>
    <Button disabled={model.busy} onClick={() => dirty ? setConfirm(true) : void model.reload()}>重新载入</Button></header>
    {model.drafts.length ? <nav aria-label="未保存的论文笔记">{model.drafts.map((draft) => <Button key={draft.object.objectId} onClick={() => model.select(draft.object.objectId)}>{draft.object.title}</Button>)}</nav> : null}
    {confirm ? <div role="group" aria-label="放弃草稿确认"><p>重新载入会放弃此笔记未保存的修改。</p><Button onClick={() => { setConfirm(false); void model.reload(); }}>放弃修改并载入</Button><Button onClick={() => setConfirm(false)}>保留草稿</Button></div> : null}
    {model.error ? <p role="alert">{model.error}</p> : null}
    {editing ? <Textarea className="external-note-source" aria-label="论文笔记 Markdown 源码" value={note.draft} onChange={(_, data) => model.setDraft(data.value)} /> : <>
      {preview.chapters.length > 1 ? <Select aria-label="笔记章节" value={part} onChange={(_, data) => setPart(Number(data.value))}>{preview.chapters.map((chapter, index) => <option key={chapter.id} value={index}>{chapter.title}</option>)}</Select> : null}
      <article className="external-note-preview">{preview.error ? <p role="alert">{preview.error}</p> : <MarkdownContent value={preview.chapters[Math.min(part, preview.chapters.length - 1)]?.content ?? ""} />}</article>
    </>}
  </section>;
}
