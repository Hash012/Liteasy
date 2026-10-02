import { useMarkdownEditing } from "../markdown/MarkdownEditingContext";
import { useContext, useEffect, useMemo, useState } from "react";
import { Button, Select } from "@fluentui/react-components";
import { BookOpenRegular, EditRegular, SaveRegular } from "@fluentui/react-icons";
import { MarkdownContent } from "../markdown/MarkdownContent";
import { MarkdownFontControl, useMarkdownFontSize } from "../markdown/MarkdownFontControl";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { textChapters } from "../reading-library/readingTextChapters";
import type { NoteFileSnapshot } from "./noteFileService";
import type { ExternalEditingStatus } from "./obsidianWorkspace";
import { ReferenceSourceContext, ResourceReferencesContext } from "../resource-links/ResourceReferencesContext";
import { liteasyPath } from "../resource-filesystem/liteasyPath";
import "./externalNoteEditor.css";

export type ExternalNoteModel = {
  session?: { snapshot: NoteFileSnapshot; draft: string; editing: boolean; changed: boolean };
  error: string; notice: string; busy: boolean; status?: ExternalEditingStatus; drafts: NoteFileSnapshot[];
  open(file: NoteFileSnapshot): void;
  setDraft(value: string): void; setEditing(value: boolean): void;
  save(copy?: boolean): Promise<void>; reload(): Promise<void>;
};
export function ExternalNoteEditor({ model }: { model: ExternalNoteModel }) {
  const references = useContext(ResourceReferencesContext);
  const font = useMarkdownFontSize();
  const preference = useMarkdownEditing();
  const live = preference.mode === "live";
  const session = model.session;
  const [part, setPart] = useState(0);
  const [confirmReload, setConfirmReload] = useState(false);
  useEffect(() => { setPart(0); setConfirmReload(false); }, [session?.snapshot.mountId, session?.snapshot.path]);
  // Only the current chapter becomes a Markdown/KaTeX/diagram tree.
  const preview = useMemo(() => {
    if (!session || session.editing || live) return { chapters: [], error: "" };
    try { return { chapters: textChapters(session.draft, session.snapshot.name, true), error: "" }; }
    catch (error) { return { chapters: [], error: String(error) }; }
  }, [session?.draft, session?.editing, session?.snapshot.name, live]);
  if (!session) return <section className="external-note-editor"><p>在笔记目录中选择 Markdown 文件，即可在此阅读和编辑。</p></section>;
  const dirty = session.draft !== session.snapshot.text;
  const selectedPart = Math.min(part, Math.max(0, preview.chapters.length - 1));
  const source = references ? liteasyPath(references.service.scope, { kind: "external-file", mountId: session.snapshot.mountId, path: session.snapshot.path }) : undefined;
  return <ReferenceSourceContext.Provider value={source}><section className="external-note-editor" style={font.style} aria-label="Markdown 文件阅读与编辑" onKeyDown={(event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void model.save(); }
  }}>
    <header>
      <div><strong>{session.snapshot.name}{dirty ? " · 未保存" : ""}</strong><small>{session.snapshot.path}</small></div>
      <MarkdownFontControl {...font} />
      {!live && <Button icon={session.editing ? <BookOpenRegular /> : <EditRegular />} onClick={() => model.setEditing(!session.editing)}>{session.editing ? "阅读" : "编辑"}</Button>}
      <Button appearance="primary" icon={<SaveRegular />} disabled={model.busy || !dirty} onClick={() => void model.save()}>保存</Button>
      <Button disabled={model.busy} onClick={() => dirty ? setConfirmReload(true) : void model.reload()}>重新载入</Button>
    </header>
    {live ? <span role="status" className="markdown-save-status">{model.busy ? "正在保存…" : session.changed || model.error || model.status?.editing ? "自动保存已暂停 · 草稿保留，可手动保存" : dirty ? preference.autosave ? "等待自动保存…" : "未保存 · Ctrl+S 保存" : "已保存"}</span> : null}
    {model.drafts.length ? <nav aria-label="未保存的文件">未保存的草稿：{model.drafts.map((file) => <Button key={`${file.mountId}:${file.path}`} disabled={model.busy}
      onClick={() => { model.open(file); setPart(0); setConfirmReload(false); }}>{file.name}</Button>)}</nav> : null}
    {model.status?.editing ? <p role="status" className="external-note-notice">Obsidian 工作区记录了此文件的编辑标签，建议先关闭对应 Tab，避免同时写入。你仍可在这里编辑；工作区记录可能有延迟。</p> : null}
    {session.changed ? <p role="status" className="external-note-notice">磁盘文件已被其他应用修改。当前草稿仍保留，可继续编辑并另存副本，或重新载入磁盘版本。</p> : null}
    {model.error ? <p role="alert">{model.error}</p> : null}
    {model.notice && (!live || model.notice !== "已保存到原文件。") ? <p role="status">{model.notice}</p> : null}
    {session.changed || model.error ? <div><Button disabled={model.busy} onClick={() => void model.save(true)}>将草稿另存副本</Button></div> : null}
    {confirmReload ? <div role="group" aria-label="重新载入确认"><p>重新载入会放弃当前未保存的修改。</p>
      <Button disabled={model.busy} onClick={() => { setConfirmReload(false); void model.reload(); }}>放弃修改并载入</Button>
      <Button onClick={() => setConfirmReload(false)}>保留草稿</Button></div> : null}
    {live || session.editing ? <MarkdownEditor className="external-note-source" value={session.draft}
      documentKey={`${session.snapshot.mountId}:${session.snapshot.path}`} onChange={model.setDraft} /> : <>
      {preview.chapters.length > 1 ? <Select aria-label="Markdown 章节" value={selectedPart} onChange={(_, data) => setPart(Number(data.value))}>
        {preview.chapters.map((chapter, index) => <option key={chapter.id} value={index}>{chapter.title}</option>)}
      </Select> : null}
      <article className="external-note-preview" key={`${session.snapshot.mountId}:${session.snapshot.path}:${selectedPart}`}>
        {preview.error ? <p role="alert">{preview.error}</p> : <MarkdownContent value={preview.chapters[selectedPart]?.content ?? ""} />}
      </article>
    </>}
  </section></ReferenceSourceContext.Provider>;
}
