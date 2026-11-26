import { createContext, useContext } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Textarea } from "@fluentui/react-components";
import { OptionPicker } from "../../shared/ui/productPrimitives";
import type { ContextEntryInput, ContextSourceRef } from "../context-cloud/contextClient";
export type ContextSelection = { title: string; text: string; basis: ContextEntryInput["basis"]; source: ContextSourceRef; kind?: ContextEntryInput["kind"] };
export const ContextPublicationContext = createContext<((selection: ContextSelection) => void) | undefined>(undefined);
export function ContextPublishButton({ selection, label = "保存到个人上下文" }: { selection: () => ContextSelection; label?: string }) {
  const publish = useContext(ContextPublicationContext);
  return publish ? <Button size="small" onClick={() => publish(selection())}>{label}</Button> : null;
}
export type ContextPublicationModel = {
  selection?: ContextSelection; scope: string; title: string; body: string; basis: ContextEntryInput["basis"];
  busy: boolean; error: string; notice: string;
  setScope(value: string): void; setTitle(value: string): void; setBody(value: string): void;
  setBasis(value: ContextEntryInput["basis"]): void; close(): void; save(): Promise<void>;
};
export function ContextPublicationDialog({ model }: { model: ContextPublicationModel }) {
  return <Dialog open={Boolean(model.selection)} onOpenChange={(_, data) => { if (!data.open && !model.busy) model.close(); }}>
    <DialogSurface><DialogBody><DialogTitle>保存选定内容</DialogTitle><DialogContent>
      <p>仅本人可见。来源：{model.selection?.source.title ?? model.selection?.source.sourceId} · {model.selection?.source.availability === "local_only" ? "原文仅在此设备可用" : "保留来源引用"}</p>
      <Field label="归组"><Input value={model.scope} onChange={(_, data) => model.setScope(data.value)} /></Field>
      <Field label="标题"><Input value={model.title} maxLength={160} onChange={(_, data) => model.setTitle(data.value)} /></Field>
      <Field label="内容依据"><OptionPicker aria-label="内容依据" value={model.basis} onValueChange={(value) => model.setBasis(value as ContextEntryInput["basis"])} options={[{ value: "user_authored", label: "本人撰写" }, { value: "user_statement", label: "本人陈述" }, { value: "agent_summary", label: "AI 整理" }, { value: "source_excerpt", label: "来源摘录" }, { value: "imported", label: "导入资料" }]} /></Field>
      <Field label="选定正文"><Textarea rows={10} value={model.body} onChange={(_, data) => model.setBody(data.value)} /></Field>
      {model.error ? <p role="alert">{model.error}</p> : null}{model.notice ? <p role="status">{model.notice}</p> : null}
    </DialogContent><DialogActions><Button disabled={model.busy} onClick={model.close}>关闭</Button><Button disabled={model.busy || !model.body.trim() || !model.title.trim()} appearance="primary" onClick={() => void model.save()}>保存到云端</Button></DialogActions></DialogBody></DialogSurface>
  </Dialog>;
}
