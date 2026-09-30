import { useRef, useState } from "react";
import { Button, Input, Textarea, Field, Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, Tooltip } from "@fluentui/react-components";
import { AddRegular, FolderAddRegular, DocumentPdfRegular, ImageRegular, LinkRegular, DocumentTextRegular, DeleteRegular, ArrowUndoRegular } from "@fluentui/react-icons";
import type { ImportResource, LibraryItem } from "./library.types";
import { useBackHandler } from "../navigation/backNavigation";

const resourceIcons = { pdf: <DocumentPdfRegular />, image: <ImageRegular />, link: <LinkRegular />, text: <DocumentTextRegular />, file: <DocumentTextRegular /> };

export function LibraryView({ items, inbox, busy, onImport, onAdd, onOpen, onUpdate }: {
  items: LibraryItem[]; inbox: boolean; busy: boolean;
  onImport: (files: File[]) => Promise<boolean>; onAdd: (input: ImportResource) => Promise<boolean>;
  onOpen: (item: LibraryItem) => void; onUpdate: (item: LibraryItem) => Promise<boolean>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState("");
  const [trash, setTrash] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  useBackHandler(trash, () => setTrash(false), 5);
  const filtered = items.filter((item) => Boolean(item.deletedAt) === trash && (!inbox || item.collection === "收件箱") &&
    (!collection || item.collection === collection) && `${item.title} ${item.note} ${item.tags.join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => (b.lastReadAt ?? b.updatedAt).localeCompare(a.lastReadAt ?? a.updatedAt));
  return <section aria-label={inbox ? "收件箱资料" : "全部资料"}>
    <div className="section-heading"><h1>{inbox ? "收件箱" : "资料库"}</h1><div className="toolbar">
      <Tooltip content="导入文件" relationship="label"><Button icon={<FolderAddRegular />} aria-label="导入文件" disabled={busy} onClick={() => fileInput.current?.click()} /></Tooltip>
      <Tooltip content="添加文字或链接" relationship="label"><Button appearance="primary" icon={<AddRegular />} aria-label="添加文字或链接" disabled={busy} onClick={() => setAdding(true)} /></Tooltip>
    </div></div>
    <input ref={fileInput} type="file" multiple hidden onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void onImport(files); }} />
    <Input className="library-search" aria-label="搜索资料" placeholder="搜索标题、备注或标签" value={query} onChange={(_, data) => setQuery(data.value)} />
    <div className="library-filters"><select aria-label="分类" value={collection} onChange={(event) => setCollection(event.target.value)}>
      <option value="">全部分类</option>{[...new Set(items.map((item) => item.collection))].sort().map((name) => <option key={name}>{name}</option>)}
    </select><Button appearance="subtle" onClick={() => setTrash(!trash)}>{trash ? "返回资料库" : "回收站"}</Button></div>
    {filtered.length === 0 ? <p className="empty-state">{trash ? "回收站为空。" : "还没有资料。导入文件，或从其他应用分享到 Liteasy。"}</p> :
      <ul className="resource-list">{filtered.map((item) => <li key={item.id}>
        <button className="resource-open" onClick={() => onOpen(item)} disabled={trash}>
          <span className="resource-icon" aria-hidden>{resourceIcons[item.kind]}</span><span className="resource-description"><strong>{item.title}</strong>
            <small>{item.collection} · {item.downloaded ? "可离线使用" : "尚未下载"}{item.page > 1 ? ` · 第 ${item.page} 页` : ""}</small></span>
        </button>
        <Tooltip content={trash ? "恢复资料" : "移到回收站"} relationship="label"><Button appearance="subtle" disabled={busy}
          aria-label={`${trash ? "恢复" : "删除"} ${item.title}`} icon={trash ? <ArrowUndoRegular /> : <DeleteRegular />}
          onClick={() => void onUpdate({ ...item, deletedAt: trash ? undefined : new Date().toISOString() })} /></Tooltip>
      </li>)}</ul>}
    <Dialog open={adding} onOpenChange={(_, data) => setAdding(data.open)}><DialogSurface><DialogBody>
      <DialogTitle>添加文字或链接</DialogTitle><DialogContent><div className="form-stack">
        <Field label="标题" required><Input value={title} onChange={(_, data) => setTitle(data.value)} /></Field>
        <Field label="内容" required><Textarea resize="vertical" value={content} onChange={(_, data) => setContent(data.value)} /></Field>
      </div></DialogContent><DialogActions><Button onClick={() => setAdding(false)}>取消</Button>
        <Button appearance="primary" disabled={busy || !title.trim() || !content.trim()} onClick={async () => {
          const value = content.trim();
          if (await onAdd({ title, ...(/^https?:\/\/\S+$/i.test(value) ? { sourceUrl: value } : { text: value }) })) {
            setAdding(false); setTitle(""); setContent("");
          }
        }}>保存</Button></DialogActions>
    </DialogBody></DialogSurface></Dialog>
  </section>;
}
