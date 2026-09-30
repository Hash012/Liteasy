import { useEffect, useState } from "react";
import { Button, Field, Input, Textarea } from "@fluentui/react-components";
import type { LibraryItem } from "./library.types";

export function ResourceDetails({ item, onSave, onClose }: {
  item: LibraryItem; onSave: (item: LibraryItem) => Promise<boolean>; onClose: () => void;
}) {
  const [draft, setDraft] = useState(item);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setDraft(item); setSaved(false); }, [item]);
  return <section className="resource-details" aria-label="资料详情">
    <div className="section-heading"><Button onClick={onClose}>返回</Button><span>{item.kind === "pdf" ? "PDF 文献" : "资料详情"}</span></div>
    <div className="form-stack">
      <Field label="标题"><Input value={draft.title} onChange={(_, data) => setDraft({ ...draft, title: data.value })} /></Field>
      <Field label="分类"><Input value={draft.collection} onChange={(_, data) => setDraft({ ...draft, collection: data.value })} /></Field>
      <Field label="标签（用逗号分隔）"><Input value={draft.tags.join(", ")} onChange={(_, data) => setDraft({ ...draft, tags: data.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) })} /></Field>
      <Field label="备注"><Textarea value={draft.note} resize="vertical" onChange={(_, data) => setDraft({ ...draft, note: data.value })} /></Field>
      {item.sourceUrl ? <Field label="来源链接"><Input value={item.sourceUrl} readOnly /></Field> : null}
      {item.text ? <article className="captured-text">{item.text}</article> : null}
      <p>{item.filename || "文字资料"} · {Math.max(1, Math.ceil(item.size / 1024))} KiB · {item.downloaded ? "已保存到本机" : "尚未下载"}</p>
      <Button appearance="primary" disabled={saving || !draft.title.trim() || !draft.collection.trim()} onClick={async () => {
        setSaving(true);
        try { setSaved(await onSave(draft)); } finally { setSaving(false); }
      }}>{saving ? "正在保存…" : "保存修改"}</Button>
      {saved ? <p role="status">修改已保存。</p> : null}
    </div>
  </section>;
}
