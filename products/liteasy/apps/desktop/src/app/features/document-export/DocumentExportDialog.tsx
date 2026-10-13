import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { Button, Checkbox, Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, Field, Select, Spinner } from "@fluentui/react-components";
import { isTauri } from "@tauri-apps/api/core";
import type { ArtifactExportOutcome, ArtifactExportPayload } from "../artifacts/artifactExport.types";
import { renderDocumentHtml } from "./documentHtml";
import { type DocumentFormat, type ExportDocument, type ExportOptions } from "./documentExport.types";
import { cancelExportJob, createExportJob, exportJobBusy, notifyExportJob, prepareExportJob, publishExportJob, restoreExportJob, retainExportJob } from "./documentExportJob";
import "./documentExport.css";
const ExportPdfPreview = lazy(() => import("./ExportPdfPreview").then(module => ({ default: module.ExportPdfPreview })));
export function DocumentExportDialog({ title, open, sourceIdentity, jobScope, initialFormat, nodes = [], allowSubtree = false, allowSpatial = false, compile, publish, onClose, onOutcome }: {
  title: string; open: boolean; sourceIdentity?: string; jobScope?: string; allowSubtree?: boolean; allowSpatial?: boolean; initialFormat: DocumentFormat; nodes?: Array<{ id: string; title: string }>;
  compile(options: Partial<ExportOptions>, signal: AbortSignal): Promise<ExportDocument>;
  publish(payload: ArtifactExportPayload, signal?: AbortSignal): Promise<ArtifactExportOutcome>;
  onClose(): void; onOutcome(outcome: ArtifactExportOutcome): void;
}) {
  const identity = JSON.stringify([jobScope, sourceIdentity ?? title, initialFormat]);
  const cacheKey = jobScope && sourceIdentity ? identity : undefined;
  const initialJob = useMemo(() => restoreExportJob(cacheKey, initialFormat), [identity]);
  const [selection, setSelection] = useState({ identity, job: initialJob });
  const job = selection.identity === identity ? selection.job : initialJob;
  const [, refresh] = useState(0), frame = useRef<HTMLIFrameElement>(null);
  const subscription = useMemo(() => ({ job, open }), [job, open]);
  const activeView = useRef(subscription); activeView.current = subscription;
  useEffect(() => {
    if (!open) return;
    const listener = () => refresh(value => value + 1);
    job.listeners.add(listener); listener();
    return () => { job.listeners.delete(listener); };
  }, [job, open]);
  useEffect(() => () => { activeView.current = { job, open: false }; }, []);
  const format = job.format, options = job.options, document = job.document, payload = job.payload, accepted = job.accepted;
  const busy = exportJobBusy(job) ? ({ compiling: "正在固定来源与预检…", rendering: "正在生成并核验文档…", saving: "正在保存…" } as Record<string, string>)[job.status] : "";
  const replaceJob = (nextFormat: DocumentFormat, nextOptions: ExportOptions) => {
    const next = createExportJob(nextFormat, nextOptions); retainExportJob(cacheKey, next); setSelection({ identity, job: next });
  };
  async function prepare() {
    if (job.status === "cancelled" || job.payload || job.status === "ready") { const next = createExportJob(format, options); retainExportJob(cacheKey, next); setSelection({ identity, job: next }); await prepareExportJob(next, compile); }
    else await prepareExportJob(job, compile);
  }
  async function save() {
    const outcome = await publishExportJob(job, publish);
    if (outcome && activeView.current === subscription && subscription.open) { onOutcome(outcome); if (outcome.status !== "cancelled") onClose(); }
  }
  return <Dialog open={open} onOpenChange={(_, data) => { if (!data.open) onClose(); }}><DialogSurface className="document-export-surface"><DialogBody className="document-export-body"><DialogTitle>导出：{title}</DialogTitle><DialogContent className="document-export-content">
    <details className="document-export-options" open><summary>导出选项</summary>
    <Field label="格式"><Select value={format} disabled={Boolean(busy)} onChange={event => { replaceJob(event.target.value as DocumentFormat, options); }}><option value="markdown">Markdown</option><option value="docx">Word (.docx)</option><option value="pdf">PDF</option><option value="html">HTML</option></Select></Field>
    <Field label="内容范围"><Select value={options.scope} disabled={Boolean(busy)} onChange={event => { replaceJob(format, { ...options, scope: event.target.value as ExportOptions["scope"] }); }}><option value="full_saved">全部已保存内容</option>{nodes.length ? <option value="selected_nodes">选中节点或卡片</option> : null}{allowSubtree ? <option value="current_subtree">选中薄读分支</option> : null}</Select></Field>
    {options.scope !== "full_saved" ? <div aria-label="导出节点">{nodes.map(node => <Checkbox key={node.id} label={node.title} checked={options.nodeIds?.includes(node.id) ?? false} onChange={(_, data) => { replaceJob(format, { ...options, nodeIds: data.checked ? [...options.nodeIds ?? [], node.id] : options.nodeIds?.filter(id => id !== node.id) }); }} />)}</div> : null}
    {allowSpatial ? <><Field label="版式"><Select value={options.profileId} disabled={Boolean(busy)} onChange={event => { replaceJob(format, { ...options, profileId: event.target.value as ExportOptions["profileId"] }); }}><option value="research-report/v1">阅读报告</option><option value="spatial-atlas/v1">空间图集（PDF/HTML）</option></Select></Field>
      {options.profileId === "spatial-atlas/v1" ? <><Field label="纸张"><Select value={options.paperSize ?? "A4"} onChange={event => { replaceJob(format, { ...options, paperSize: event.target.value as "A4" | "A3" }); }}><option>A4</option><option>A3</option></Select></Field><Checkbox label="横向纸张" checked={options.orientation === "landscape"} onChange={(_, data) => { replaceJob(format, { ...options, orientation: data.checked ? "landscape" : "portrait" }); }} /></> : null}</> : null}
    <Field label="证据篇幅"><Select value={options.evidenceMode} disabled={Boolean(busy)} onChange={event => { replaceJob(format, { ...options, evidenceMode: event.target.value as ExportOptions["evidenceMode"] }); }}><option value="references">来源索引</option><option value="excerpts">标明摘录</option><option value="full_appendix">完整证据附录</option></Select></Field>
    <p>阅读报告 · 本地附件。PDF 使用本机字体；Markdown 有附件时保存 ZIP。DOCX 分页由打开它的软件决定。</p>
    </details><section className="document-export-preview" aria-label="本次文档预览" data-export-job={job.id}>
    {busy ? <Spinner label={busy} /> : null}{job.error ? <p role="alert">{job.error}</p> : null}
    {job.outcome && job.outcome.status !== "cancelled" ? <p role="status">{job.outcome.status === "saved" ? "本次文档已保存。" : "本次文档已交给浏览器下载。"}</p> : null}
    {document ? <><p>已固定 {document.sources.length} 个来源、{document.assets.length} 个附件。</p>{document.diagnostics.length ? <><ul>{document.diagnostics.map((issue, index) => <li key={`${issue.nodeId}-${issue.code}-${index}`}>{issue.message}</li>)}</ul><Checkbox label="我已了解缺失资源与格式降级，继续导出" disabled={Boolean(busy)} checked={accepted} onChange={(_, data) => { job.accepted = Boolean(data.checked); if (!data.checked) { job.payload = undefined; job.status = "review"; } notifyExportJob(job); }} /></> : null}
      {payload?.format === "pdf" ? <Suspense fallback={<Spinner label="正在读取 PDF…" />}><ExportPdfPreview payload={payload} /></Suspense> : <><p>{format === "docx" ? "结构预览；最终分页由 Word/WPS 等软件决定。" : format === "pdf" ? "文档结构预览；尚未生成可核验 PDF，保存由系统打印管理。" : "文档结构预览"}</p><iframe className="document-export-structure" ref={frame} title="导出文档结构预览" sandbox="allow-same-origin allow-modals" srcDoc={renderDocumentHtml(document)} /></>}
    </> : !busy ? <p>选择范围后生成预览。来源或选项变化后需要重新生成。</p> : null}
  </section></DialogContent><DialogActions className="document-export-actions">
    <Button onClick={onClose}>关闭</Button>
    {busy && job.status !== "saving" ? <Button onClick={() => cancelExportJob(job)}>取消任务</Button> : null}
    <Button disabled={Boolean(busy)} onClick={() => void prepare()}>{payload || job.status === "ready" ? "重新生成预览" : "生成预览"}</Button>
    {format === "pdf" && !isTauri() ? <Button disabled={!document || Boolean(busy) || job.status === "cancelled" || document.diagnostics.some(issue => issue.severity === "error") || document.diagnostics.length > 0 && !accepted} onClick={() => { void (async () => { try { await document?.assertAuthorized?.(); if (activeView.current !== subscription || !subscription.open) return; frame.current?.contentWindow?.print(); job.error = "已打开系统打印；保存位置由打印对话框管理。"; } catch (error) { job.error = error instanceof Error ? error.message : "打印失败。"; } notifyExportJob(job); })(); }}>系统打印</Button> : <Button appearance="primary" disabled={!payload || Boolean(busy) || job.status === "cancelled"} onClick={() => void save()}>保存本次文档</Button>}
  </DialogActions></DialogBody></DialogSurface></Dialog>;
}
