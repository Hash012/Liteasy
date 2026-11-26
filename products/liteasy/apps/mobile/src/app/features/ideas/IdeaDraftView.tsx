import { useState } from "react";
import { Button, Field, Input, Textarea } from "@fluentui/react-components";
import type { IdeaDraft } from "./ideaDrafts";
type Controls = ReturnType<typeof import("../../controllers/useIdeaController").useIdeaController>;
export function IdeaDraftView({ controls }: { controls: Controls }) {
  const [edit, setEdit] = useState<IdeaDraft>();
  return <section className="form-stack" aria-label="Idea 草稿"><h1>Idea</h1>
    <p>想法先保存在本机；点击提交并收到回执后才会保存到云端。</p>
    <Button disabled={controls.busy} onClick={() => setEdit(controls.create())}>记录新想法</Button>
    {edit ? <div className="form-stack"><Field label="标题（可选）"><Input value={edit.title} onChange={(_, data) => setEdit({ ...edit, title: data.value })} /></Field>
      <Field label="想法"><Textarea rows={6} value={edit.bodyMarkdown} onChange={(_, data) => setEdit({ ...edit, bodyMarkdown: data.value })} /></Field>
      <Field label="归组"><Input value={edit.scopeKey} onChange={(_, data) => setEdit({ ...edit, scopeKey: data.value })} /></Field>
      <Field label="来源链接（可选）"><Input value={edit.sourceUrl ?? ""} onChange={(_, data) => setEdit({ ...edit, sourceUrl: data.value || undefined })} /></Field>
      <Button disabled={controls.busy || !edit.bodyMarkdown.trim()} onClick={async () => { if (await controls.save(edit)) setEdit(undefined); }}>保存到本机</Button><Button onClick={() => setEdit(undefined)}>关闭编辑</Button></div> : null}
    <ul>{controls.drafts.map((draft) => <li key={draft.id}><strong>{draft.title || draft.bodyMarkdown.slice(0, 60)}</strong><p>{draft.bodyMarkdown}</p>
      <p role="status">{draft.receipt ? `云端已保存 · ${draft.receipt.entryId} · 版本 ${draft.receipt.revision}` : draft.pending ? "待提交 · 上次结果尚未确认" : "本机已保存"}</p>
      {!draft.pending && !draft.receipt ? <Button disabled={controls.busy} onClick={() => setEdit(draft)}>编辑</Button> : null}
      {!draft.receipt && draft.ownerScope !== "local" ? <Button disabled={controls.busy} onClick={() => void controls.submit(draft)}>{draft.pending ? "核查并重试提交" : "提交到当前账号云端"}</Button> : null}
      {draft.ownerScope === "local" && controls.account.subject ? <Button disabled={controls.busy} onClick={() => void controls.copyToAccount(draft)}>复制到当前登录账号草稿</Button> : null}
    </li>)}</ul>
    {controls.error ? <p role="alert">{controls.error}</p> : null}{controls.notice ? <p role="status">{controls.notice}</p> : null}
  </section>;
}
