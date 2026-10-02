import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Checkbox } from "@fluentui/react-components";
import { FolderOpenRegular, SaveRegular } from "@fluentui/react-icons";
import { displayPath } from "../resource-filesystem/displayPath";
import {
  createLocalArchiveService, isLocalArchiveAvailable,
  type ArchiveCatalogEntry, type ArchivePreview, type ArchiveReceipt, type LocalArchiveService
} from "./localArchiveService";

export function LocalArchivePanel({ scopeId, service }: { scopeId: string; service?: LocalArchiveService }) {
  const currentScope = useRef(scopeId); currentScope.current = scopeId;
  const api = useMemo(() => service ?? createLocalArchiveService(scopeId, () => currentScope.current), [scopeId, service]);
  const available = Boolean(service) || isLocalArchiveAvailable();
  const generation = useRef(0);
  const pendingPreview = useRef<ArchivePreview | null>(null);
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<ArchiveCatalogEntry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<ArchivePreview | null>(null);
  const [receipt, setReceipt] = useState<ArchiveReceipt | null>(null);
  const [note, setNote] = useState<{ title: string; body: string } | null>(null);
  const [error, setError] = useState("");
  const active = (revision: number) => currentScope.current === scopeId && generation.current === revision;
  useEffect(() => {
    const revision = ++generation.current;
    working.current = false; pendingPreview.current = null;
    setBusy(false); setPreview(null); setReceipt(null); setNote(null); setError(""); setSelected([]); setCatalog([]);
    if (available) void api.catalog().then((rows) => { if (active(revision)) setCatalog(rows); })
      .catch((failure) => { if (active(revision)) setError(String(failure)); });
    return () => {
      ++generation.current;
      if (pendingPreview.current) void api.cancel(pendingPreview.current.planId).catch(() => undefined);
      pendingPreview.current = null;
    };
  }, [scopeId, api, available]);

  async function perform(work: (revision: number) => Promise<void>) {
    if (working.current) return;
    const revision = generation.current;
    working.current = true; setBusy(true); setError("");
    try { await work(revision); }
    catch (failure) { if (active(revision)) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (active(revision)) { working.current = false; setBusy(false); } }
  }
  async function prepare(kind: "export" | "restore") {
    await perform(async (revision) => {
      if (pendingPreview.current) await api.cancel(pendingPreview.current.planId);
      pendingPreview.current = null; setPreview(null); setReceipt(null); setNote(null);
      const next = kind === "export" ? await api.prepareExport(selected) : await api.prepareRestore();
      if (!active(revision)) { if (next) await api.cancel(next.planId); return; }
      pendingPreview.current = next; setPreview(next);
    });
  }
  async function confirm() {
    if (!preview) return;
    const plan = preview;
    await perform(async (revision) => {
      pendingPreview.current = null; setPreview(null);
      const saved = await api.commit(plan.planId);
      if (active(revision)) setReceipt(saved);
    });
  }
  function readNote(noteId: string, title: string) {
    if (!receipt) return;
    void perform(async (revision) => {
      const body = await api.readNote(receipt.receiptId, noteId);
      if (active(revision)) setNote({ title, body });
    });
  }
  if (!available) return <p>请在桌面应用中归档或恢复本地资料。</p>;
  return <section aria-label="本地资料归档" className="library-location-panel">
    <h3>所选资料归档与恢复</h3>
    <p>归档所选原文、批注、关联笔记和来源关系。先校验预览，确认后写入新的目录；当前文献库保持原样。</p>
    <div aria-label="归档文献选择" style={{ maxHeight: 240, overflow: "auto" }}>
      {catalog.map((entry) => <div key={entry.id}><Checkbox
        checked={selected.includes(entry.id)} disabled={busy || Boolean(preview) || !entry.available}
        label={`${entry.title}${entry.available ? "" : "（原文缺失）"}`}
        onChange={(_, data) => setSelected((current) => data.checked ? [...current, entry.id] : current.filter((id) => id !== entry.id))}
      /></div>)}
      {!catalog.length ? <p>当前文献库没有可归档的原文。</p> : null}
    </div>
    <div className="library-location-actions">
      <Button disabled={busy || !selected.length || Boolean(preview)} icon={<SaveRegular />} onClick={() => void prepare("export")}>预览所选资料归档</Button>
      <Button disabled={busy || Boolean(preview)} icon={<FolderOpenRegular />} onClick={() => void prepare("restore")}>校验归档并恢复</Button>
      <Button disabled={busy || Boolean(preview)} onClick={() => void perform(async (revision) => {
        const rows = await api.catalog(); if (active(revision)) { setCatalog(rows); setSelected((ids) => ids.filter((id) => rows.some((row) => row.id === id && row.available))); }
      })}>刷新文献列表</Button>
    </div>
    {preview ? <div aria-label="归档写入预览">
      <h4>{preview.operation === "restore" ? "恢复预览" : "导出预览"}</h4>
      <p>新目录：<span>{displayPath(preview.targetPath)}</span></p>
      <p>{preview.manifest.documents.length} 篇原文 · {preview.manifest.notes.length} 篇关联笔记 · {preview.manifest.relations.length} 条来源关系 · {(preview.totalBytes / 1024 / 1024).toFixed(2)} MiB</p>
      <p>不包含：{preview.manifest.exclusions.join("、")}。</p>
      <details><summary>查看将写入的文件</summary><ul>{preview.manifest.files.map((file) => <li key={file.path}>{file.path} · {file.size} 字节</li>)}</ul></details>
      <Button appearance="primary" disabled={busy} onClick={() => void confirm()}>确认写入新目录</Button>
      <Button disabled={busy} onClick={() => void perform(async () => { await api.cancel(preview.planId); pendingPreview.current = null; setPreview(null); })}>取消预览</Button>
    </div> : null}
    {busy ? <p role="status">正在校验或保存资料，请稍候。</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {receipt ? <div aria-label="已完成资料归档">
      <p role="status">已保存并校验 {receipt.fileCount} 个文件：{displayPath(receipt.path)}</p>
      <Button disabled={busy} onClick={() => void perform(async () => { await api.reveal(receipt.receiptId); })}>在文件管理器中查看归档</Button>
      {receipt.manifest.documents.map((document) => <div key={document.id}>
        <Button disabled={busy} aria-label={`打开原文 ${document.title}`} onClick={() => void perform(async () => { await api.openDocument(receipt.receiptId, document.id); })}>打开原文 {document.title}</Button>
        <Button disabled={busy} aria-label={`阅读批注 ${document.title}`} onClick={() => readNote(document.id, document.title)}>阅读批注文字</Button>
      </div>)}
      {receipt.manifest.notes.map((entry) => <Button key={entry.id} disabled={busy} aria-label={`阅读笔记 ${entry.title}`} onClick={() => readNote(entry.id, entry.title)}>阅读笔记 {entry.title}</Button>)}
      <p>原文可继续使用现有阅读器；批注文字与笔记也保存在归档的 Markdown 文件中。归档中的绘图、图片和结构化批注数据保留在 annotations 目录。</p>
    </div> : null}
    {note ? <article aria-label={`归档笔记 ${note.title}`}><h4>{note.title}</h4><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 400, overflow: "auto" }}>{note.body}</pre></article> : null}
  </section>;
}
