import { useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Textarea } from "@fluentui/react-components";
import type { CaptureEdit, SharedCapture } from "./shareInbox";

export function ShareInboxView({ captures, busy, error, onSave, onDiscard }: {
  captures: SharedCapture[]; busy: boolean; error: string;
  onSave: (id: string, input: CaptureEdit) => Promise<boolean>; onDiscard: (id: string) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<SharedCapture>();
  const [edit, setEdit] = useState<CaptureEdit>({ title: "", collection: "收件箱", note: "" });
  if (!captures.length && !error) return null;
  return <section className="capture-inbox" aria-label="收到的分享">
    <h2>收到的分享</h2>
    {error ? <p className="error-message" role="alert">{error}</p> : null}
    <ul className="capture-list">{captures.map((capture) => <li key={capture.id}>
      <div><strong>{capture.title}</strong><p role="status">{capture.state === "capturing" ? "正在接收附件…" : capture.state === "ready" ? "已保存在本机，等待归档" : capture.error}</p></div>
      {capture.state === "ready" ? <Button disabled={busy} appearance="primary" onClick={() => {
        setSelected(capture); setEdit({ title: capture.title, collection: capture.collection, note: capture.note });
      }}>归档</Button> : null}
      {capture.state !== "capturing" ? <Button disabled={busy} onClick={() => void onDiscard(capture.id)}>删除分享</Button> : null}
    </li>)}</ul>
    <Dialog open={!!selected} onOpenChange={(_, data) => { if (!data.open && !busy) setSelected(undefined); }}>
      <DialogSurface><DialogBody>
        <DialogTitle>归档到资料库</DialogTitle>
        <DialogContent className="form-stack">
          {selected?.filename ? <p>{selected.filename} · {Math.max(1, Math.ceil((selected.size ?? 0) / 1024))} KiB</p> : null}
          {selected?.sourceUrl ? <p className="captured-text">{selected.sourceUrl}</p> : selected?.text ? <p className="capture-preview">{selected.text.slice(0, 600)}</p> : null}
          <Field label="标题"><Input value={edit.title} onChange={(_, data) => setEdit({ ...edit, title: data.value })} /></Field>
          <Field label="分类"><Input value={edit.collection} onChange={(_, data) => setEdit({ ...edit, collection: data.value })} /></Field>
          <Field label="备注"><Textarea value={edit.note} onChange={(_, data) => setEdit({ ...edit, note: data.value })} /></Field>
          {error ? <p role="alert">{error}</p> : null}
        </DialogContent>
        <DialogActions><Button disabled={busy} onClick={() => setSelected(undefined)}>稍后归档</Button>
          <Button appearance="primary" disabled={busy || !edit.title.trim() || !edit.collection.trim()} onClick={async () => {
            if (selected && await onSave(selected.id, edit)) setSelected(undefined);
          }}>{busy ? "正在归档…" : "保存到资料库"}</Button></DialogActions>
      </DialogBody></DialogSurface>
    </Dialog>
  </section>;
}
