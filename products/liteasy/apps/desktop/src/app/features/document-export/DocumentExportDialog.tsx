import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { Button, Checkbox, Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, Field, Select, Spinner } from "@fluentui/react-components";
import { isTauri } from "@tauri-apps/api/core";
import type { ArtifactExportOutcome, ArtifactExportPayload } from "../artifacts/artifactExport.types";
import { renderDocumentHtml } from "./documentHtml";
import { renderExportDocument } from "./documentExportService";
import { defaultExportOptions, type DocumentFormat, type ExportDocument, type ExportOptions } from "./documentExport.types";
const ExportPdfPreview = lazy(() => import("./ExportPdfPreview").then(module => ({ default: module.ExportPdfPreview })));
export function DocumentExportDialog({ title, open, initialFormat, nodes = [], allowSubtree = false, allowSpatial = false, compile, publish, onClose, onOutcome }: {
  title: string; open: boolean; allowSubtree?: boolean; allowSpatial?: boolean; initialFormat: DocumentFormat; nodes?: Array<{ id: string; title: string }>;
  compile(options: Partial<ExportOptions>, signal: AbortSignal): Promise<ExportDocument>;
  publish(payload: ArtifactExportPayload, signal?: AbortSignal): Promise<ArtifactExportOutcome>;
  onClose(): void; onOutcome(outcome: ArtifactExportOutcome): void;
}) {
  const [format, setFormat] = useState(initialFormat), [options, setOptions] = useState<ExportOptions>(defaultExportOptions);
  const [document, setDocument] = useState<ExportDocument>(), [payload, setPayload] = useState<ArtifactExportPayload>();
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [accepted, setAccepted] = useState(false);
  const job = useRef<AbortController>(), frame = useRef<HTMLIFrameElement>(null), frozen = useRef<ExportDocument>();
  useEffect(() => { if (open) { setFormat(initialFormat); setOptions(defaultExportOptions); frozen.current = undefined; setDocument(undefined); setPayload(undefined); setAccepted(false); setError(""); } }, [open, initialFormat]);
  // Closing the preview detaches the view. Only the explicit cancel action stops a job.
  const invalidate = () => { job.current?.abort(); job.current = undefined; frozen.current = undefined; setDocument(undefined); setPayload(undefined); setAccepted(false); setError(""); setBusy(""); };
  async function prepare() {
    const controller = new AbortController(); job.current?.abort(); job.current = controller; setBusy("正在固定来源与预检…"); setError("");
    try {
      const value = frozen.current ?? await compile(options, controller.signal);
      controller.signal.throwIfAborted();
      if (format === "docx") { const { preflightDocx } = await import("./documentDocx"); preflightDocx(value); }
      frozen.current = value; setDocument(value);
      if (value.diagnostics.some(issue => issue.severity === "error") || value.diagnostics.length && !accepted) return;
      value.options.acceptDegradations = accepted;
      if (format === "pdf" && !isTauri()) return;
      setBusy("正在生成并核验文档…");
      const result = await renderExportDocument(value, format, controller.signal);
      controller.signal.throwIfAborted(); setPayload(result);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "导出失败。"); }
    finally { if (job.current === controller) setBusy(""); }
  }
  async function save() {
    if (!payload) return;
    const controller = new AbortController(); job.current = controller; setBusy("正在保存…"); setError("");
    try { await frozen.current?.assertAuthorized?.(); controller.signal.throwIfAborted(); const outcome = await publish(payload, controller.signal); onOutcome(outcome); if (outcome.status !== "cancelled") onClose(); }
    catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "保存失败。"); }
    finally { if (job.current === controller) setBusy(""); }
  }
  return <Dialog open={open} onOpenChange={(_, data) => { if (!data.open && busy !== "正在保存…") onClose(); }}><DialogSurface style={{ maxWidth: 900, width: "90vw" }}><DialogBody><DialogTitle>导出：{title}</DialogTitle><DialogContent>
    <Field label="格式"><Select value={format} disabled={Boolean(busy)} onChange={event => { invalidate(); setFormat(event.target.value as DocumentFormat); }}><option value="markdown">Markdown</option><option value="docx">Word (.docx)</option><option value="pdf">PDF</option><option value="html">HTML</option></Select></Field>
    <Field label="内容范围"><Select value={options.scope} disabled={Boolean(busy)} onChange={event => { invalidate(); setOptions({ ...options, scope: event.target.value as ExportOptions["scope"] }); }}><option value="full_saved">全部已保存内容</option>{nodes.length ? <option value="selected_nodes">选中节点或卡片</option> : null}{allowSubtree ? <option value="current_subtree">选中薄读分支</option> : null}</Select></Field>
    {options.scope !== "full_saved" ? <div aria-label="导出节点">{nodes.map(node => <Checkbox key={node.id} label={node.title} checked={options.nodeIds?.includes(node.id) ?? false} onChange={(_, data) => { invalidate(); setOptions({ ...options, nodeIds: data.checked ? [...options.nodeIds ?? [], node.id] : options.nodeIds?.filter(id => id !== node.id) }); }} />)}</div> : null}
    {allowSpatial ? <><Field label="版式"><Select value={options.profileId} disabled={Boolean(busy)} onChange={event => { invalidate(); setOptions({ ...options, profileId: event.target.value as ExportOptions["profileId"] }); }}><option value="research-report/v1">阅读报告</option><option value="spatial-atlas/v1">空间图集（PDF/HTML）</option></Select></Field>
      {options.profileId === "spatial-atlas/v1" ? <><Field label="纸张"><Select value={options.paperSize ?? "A4"} onChange={event => { invalidate(); setOptions({ ...options, paperSize: event.target.value as "A4" | "A3" }); }}><option>A4</option><option>A3</option></Select></Field><Checkbox label="横向纸张" checked={options.orientation === "landscape"} onChange={(_, data) => { invalidate(); setOptions({ ...options, orientation: data.checked ? "landscape" : "portrait" }); }} /></> : null}</> : null}
    <Field label="证据篇幅"><Select value={options.evidenceMode} disabled={Boolean(busy)} onChange={event => { invalidate(); setOptions({ ...options, evidenceMode: event.target.value as ExportOptions["evidenceMode"] }); }}><option value="references">来源索引</option><option value="excerpts">标明摘录</option><option value="full_appendix">完整证据附录</option></Select></Field>
    <p>阅读报告 · 本地附件。PDF 使用本机字体；Markdown 有附件时保存 ZIP。DOCX 分页由打开它的软件决定。</p>
    {busy ? <Spinner label={busy} /> : null}{error ? <p role="alert">{error}</p> : null}
    {document ? <><p>已固定 {document.sources.length} 个来源、{document.assets.length} 个附件。</p>{document.diagnostics.length ? <><ul>{document.diagnostics.map((issue, index) => <li key={`${issue.nodeId}-${issue.code}-${index}`}>{issue.message}</li>)}</ul><Checkbox label="我已了解缺失资源与格式降级，继续导出" checked={accepted} onChange={(_, data) => { setAccepted(Boolean(data.checked)); if (!data.checked) setPayload(undefined); }} /></> : null}
      {payload?.format === "pdf" ? <Suspense fallback={<Spinner label="正在读取 PDF…" />}><ExportPdfPreview payload={payload} /></Suspense> : <><p>{format === "docx" ? "结构预览；最终分页由 Word/WPS 等软件决定。" : "文档结构预览"}</p><iframe ref={frame} title="导出文档结构预览" sandbox="allow-same-origin allow-modals" srcDoc={renderDocumentHtml(document)} style={{ width: "100%", height: 360, border: "1px solid #ddd" }} /></>}
    </> : null}
  </DialogContent><DialogActions>
    {busy && busy !== "正在保存…" ? <Button onClick={() => { job.current?.abort(); setBusy(""); setError("导出已取消，尚未发布文件。"); }}>取消任务</Button> : <Button disabled={busy === "正在保存…"} onClick={onClose}>关闭</Button>}
    <Button disabled={Boolean(busy)} onClick={() => void prepare()}>生成预览</Button>
    {format === "pdf" && !isTauri() ? <Button disabled={!document || Boolean(busy) || document.diagnostics.length > 0 && !accepted} onClick={() => { frame.current?.contentWindow?.print(); setError("已打开系统打印；保存位置由打印对话框管理。"); }}>系统打印</Button> : <Button appearance="primary" disabled={!payload || Boolean(busy)} onClick={() => void save()}>保存本次文档</Button>}
  </DialogActions></DialogBody></DialogSurface></Dialog>;
}
