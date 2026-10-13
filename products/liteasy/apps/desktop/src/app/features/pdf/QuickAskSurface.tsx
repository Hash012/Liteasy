import { redactDiagnostic } from "../context/objectContext";
import { useRef, useState, type RefObject } from "react";
import { Button } from "@fluentui/react-components";
import { CopyRegular, DismissRegular } from "@fluentui/react-icons";
import { QuickAskProvenance } from "./QuickAskProvenance";
import { PdfAnnotationMarkdown } from "./PdfAnnotationMarkdown";
import type { QuickAskPhase } from "./useQuickAskTask";
import type { QuickAskContextSnapshot } from "../../../../../../packages/reading-core/src/quickAsk";
import { ResponsiveOverlay, SourceDisclosure, ContextSummary, InlineNotice, GenerationComposer } from "../../shared/ui/productPrimitives";

const phases: Record<QuickAskPhase, string> = { ready: "选择任务即可开始", preparing: "正在准备资料…", streaming: "正在回答…", completed_unsaved: "回答完成，正在保存…", saved: "已保存为私人批注", failed: "本次回答没有完成", interrupted: "回答已停止，保留了已有内容", save_failed: "回答完成，尚未保存" };
const names = { selection: "选段", page: "本页", abstract: "摘要", introduction: "引言" };
const statuses = { available: "可用", partial: "部分可用", not_found: "未找到", not_ready: "未就绪", unreadable: "无法读取", omitted_budget: "因长度未投递", unsupported: "不支持" };
export function QuickAskSurface(props: {
  open: boolean; onClose(): void; page: number; excerpt: string; anchor?: { getBoundingClientRect(): DOMRect };
  returnFocusRef?: RefObject<HTMLElement | null>; width: number; instruction: string; onInstruction(value: string): void; taskPicker: React.ReactNode;
  primaryAction: string; phase: QuickAskPhase; busy: boolean; ready: boolean; text: string; error: string;
  context?: QuickAskContextSnapshot; onSubmit(): void; onStop(): void; onRetrySave(): void;
  onDiscard(): void; onSavePreset(): void; preferences?: React.ReactNode; onTransfer?: () => void;
}) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [side, setSide] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const actions = <>
    {props.phase === "save_failed" ? <Button ref={primaryRef} appearance="primary" onClick={props.onRetrySave}>重试保存</Button> :
      props.busy ? <Button ref={primaryRef} onClick={props.onStop} disabled={props.phase === "completed_unsaved"}>停止回答</Button> :
        <Button ref={primaryRef} appearance="primary" onClick={props.onSubmit} disabled={!props.ready}>{props.text ? "重新生成" : props.primaryAction}</Button>}
    {props.text ? <Button icon={<CopyRegular />} onClick={() => { void Promise.resolve().then(() => navigator.clipboard.writeText(props.text)).then(() => { setCopied(true); setCopyError(""); }, () => setCopyError("复制失败，请选中正文复制。")); }}>{copied ? "已复制" : "复制回答"}</Button> : null}
    {props.phase === "saved" && props.onTransfer ? <Button onClick={props.onTransfer}>转到对话</Button> : null}
    <Button appearance="subtle" onClick={props.onClose}>收起</Button>
  </>;
  return <ResponsiveOverlay open={props.open} onClose={props.onClose} anchor={props.anchor} availableWidth={props.width}
    initialFocusRef={primaryRef} returnFocusRef={props.returnFocusRef} mode={side ? "side" : "auto"} title={`速问 · 第 ${props.page} 页`} actions={actions}>
    <div className="quick-ask-surface" onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); if (!props.busy && props.ready) props.onSubmit(); } }}>
      <SourceDisclosure summary="所选原文"><p className="quick-ask-excerpt-full">{props.excerpt}</p></SourceDisclosure>
      <p className="quick-ask-excerpt">{props.excerpt}</p>
      {props.taskPicker}
      <GenerationComposer label="速问问题" placeholder="补充要求（可选）" value={props.instruction}
        onChange={props.onInstruction} disabled={props.busy} />
      {props.instruction.trim() ? <Button size="small" appearance="subtle" onClick={props.onSavePreset}>存为快捷指令</Button> : null}
      {props.preferences ? <SourceDisclosure summary="回答偏好">{props.preferences}</SourceDisclosure> : null}
      <ContextSummary>{props.context ? props.context.available.map((p, i) => <span key={i}>{p.roles.map((r) => names[r]).join("/")}：{statuses[p.status]} </span>) : "选段 · 本页 · 摘要 · 引言（提交时读取实际可用资料）"}</ContextSummary>
      {props.context ? <SourceDisclosure summary="查看来源与实际投递范围">
        <p>来源有记录；回答未经独立语义核验。图像未包含在文字资料中。</p>
        <p>文献修订：{props.context.source.documentRevision}</p>
        {props.context.delivered.map((p, i) => <div key={i}><strong>{p.roles.map((r) => names[r]).join("/")} · 页 {p.spans.map((s) => s.page).join("、")}</strong><p>{p.complete ? "完整" : "部分"}投递 · {p.text.length} 字符{p.reason ? ` · ${p.reason}` : ""}</p></div>)}
        {props.context.omitted.map((p, i) => <p key={i}>{names[p.role]}：{p.reason}</p>)}
      </SourceDisclosure> : null}
      <p role="status" aria-live="polite">{phases[props.phase]}</p>
      {props.error ? <><InlineNotice intent="error" message={props.phase === "save_failed" ? "回答尚未保存，正文已保留。请重试保存。" : "本次回答没有完成，已保留你的问题和选段。"} /><SourceDisclosure summary="查看错误详情"><p>{redactDiagnostic(props.error)}</p></SourceDisclosure></> : null}
      {copyError ? <InlineNotice intent="error" message={copyError} /> : null}
      {props.text ? <><PdfAnnotationMarkdown value={props.text} /><QuickAskProvenance context={props.context} answer={props.text} /><Button size="small" onClick={() => setSide(!side)}>{side ? "取消固定" : "固定到阅读器侧边"}</Button></> : null}
      {!props.busy ? <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={props.onDiscard}>丢弃草稿</Button> : null}
    </div>
  </ResponsiveOverlay>;
}
