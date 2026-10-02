import { useState, useSyncExternalStore } from "react";
import { Button, Checkbox, Switch, Textarea } from "@fluentui/react-components";
import { diagnosticEnvironment, downloadDiagnosticPackage, serializeDiagnosticPackage, type DiagnosticEnvironment } from "./diagnosticPackage";
import { localDiagnostics, type DiagnosticRecord } from "./localDiagnostics";
import "./local-diagnostics.css";

type Preview = { generation: number; records: readonly DiagnosticRecord[]; droppedRecords: number; environment: DiagnosticEnvironment };
const stages = { choose_file: "选择文件", read_file: "读取文件", open_reader: "准备阅读器" };
const outcomes = { succeeded: "完成", cancelled: "已取消", failed: "失败" };

export function LocalDiagnosticsPanel() {
  const snapshot = useSyncExternalStore(localDiagnostics.subscribe, localDiagnostics.getSnapshot);
  const [preview, setPreview] = useState<Preview>();
  const [includeEnvironment, setIncludeEnvironment] = useState(true);
  const [exportError, setExportError] = useState(false);
  // A scope reset, opt-out or new collection session invalidates a previously reviewed package.
  const currentPreview = preview?.generation === snapshot.generation ? preview : undefined;
  const json = currentPreview ? serializeDiagnosticPackage(currentPreview.records, currentPreview.droppedRecords,
    includeEnvironment ? currentPreview.environment : undefined) : "";
  return <details className="local-diagnostics">
    <summary>本地诊断</summary>
    <p>默认关闭。启用后可离开帮助页重现打开原文件的问题，再返回预览。仅保留本次窗口最近 100 条阶段、状态、格式和耗时，不含正文、路径、搜索词、密钥或账号，不会上传。</p>
    <Switch label="记录本次窗口的诊断" checked={snapshot.enabled} onChange={(_, data) => localDiagnostics.setEnabled(data.checked)} />
    <p role="status">{snapshot.enabled ? "正在记录" : "记录已关闭"} · {snapshot.records.length} 条记录{snapshot.droppedRecords ? ` · 已丢弃较早的 ${snapshot.droppedRecords} 条` : ""}</p>
    <div className="local-diagnostics-actions">
      <Button onClick={() => { setPreview({ generation: snapshot.generation, records: snapshot.records, droppedRecords: snapshot.droppedRecords, environment: diagnosticEnvironment() }); setExportError(false); }}>预览诊断包</Button>
      <Button onClick={() => { localDiagnostics.reset(); setPreview(undefined); setExportError(false); }}>关闭并清空记录</Button>
    </div>
    {currentPreview ? <section aria-label="诊断包预览">
      <p>预览是固定快照。之后产生的记录不会自动加入；删除条目或取消环境信息后，导出内容会与下方预览一致。</p>
      <Checkbox label="包含应用版本与环境信息" checked={includeEnvironment} onChange={(_, data) => setIncludeEnvironment(data.checked === true)} />
      <p>环境信息来自当前窗口，无法识别的架构或 WebView 版本显示为 unknown。</p>
      <ul>{currentPreview.records.map((record) => <li key={record.sequence}>
        <span>{record.sequence}. {stages[record.stage]} · {outcomes[record.outcome]} · {record.durationMs} ms</span>
        <Button size="small" aria-label={`从诊断包删除第 ${record.sequence} 条记录`} onClick={() => setPreview({ ...currentPreview, records: currentPreview.records.filter((item) => item.sequence !== record.sequence) })}>删除</Button>
      </li>)}</ul>
      <Textarea aria-label="诊断包 JSON 预览" readOnly value={json} resize="vertical" />
      <Button onClick={() => { try { downloadDiagnosticPackage(json); setExportError(false); } catch { setExportError(true); } }}>导出已预览的诊断包</Button>
      {exportError ? <p role="alert">无法下载诊断包，请复制上方预览内容保存。</p> : null}
    </section> : null}
  </details>;
}
