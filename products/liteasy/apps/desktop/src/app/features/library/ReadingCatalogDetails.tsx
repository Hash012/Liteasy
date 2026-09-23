import { useEffect, useState, type ReactNode } from "react";
import { Button, Field, Input, Select, Tooltip } from "@fluentui/react-components";
import { ArrowDownloadRegular, CopyRegular, DeleteRegular, FolderOpenRegular, OpenRegular } from "@fluentui/react-icons";
import { MarkdownContent } from "../markdown/MarkdownContent";
import { displayPath } from "../resource-filesystem/displayPath";
import { formatCatalogFileSize, readingCatalogCitation } from "./readingCatalogSearch";
import {
  readingCatalogFormatLabels, readingCatalogStatusLabels,
  type ReadingCatalogEntry, type ReadingCatalogMetadataPatch, type ReadingCatalogStatus
} from "./readingCatalog.types";

export type ReadingCatalogActions = {
  onOpen: (entry: ReadingCatalogEntry) => void | Promise<void>;
  onReveal?: (entry: ReadingCatalogEntry) => void | Promise<void>;
  onAddToContext?: (entry: ReadingCatalogEntry) => void | Promise<void>;
  onExport?: (entry: ReadingCatalogEntry) => void | Promise<void>;
  onDelete?: (entry: ReadingCatalogEntry) => void | Promise<void>;
  onMetadataChange?: (id: string, patch: ReadingCatalogMetadataPatch) => void | Promise<void>;
  renderLocation?: (entry: ReadingCatalogEntry) => ReactNode;
};

function CopyValue({ label, value, onCopy }: { label: string; value: string; onCopy: (value: string) => void }) {
  return <Field label={label} className="reading-catalog-detail-field">
    <div className="reading-catalog-copy-field">
      <Input aria-label={label} readOnly value={value} />
      <Tooltip content={`复制${label}`} relationship="description">
        <Button aria-label={`复制${label}`} appearance="subtle" icon={<CopyRegular />} onClick={() => onCopy(value)} />
      </Tooltip>
    </div>
  </Field>;
}

export function ReadingCatalogDetails({ entry, ...actions }: { entry: ReadingCatalogEntry } & ReadingCatalogActions) {
  const [collection, setCollection] = useState(entry.collection ?? "");
  const [tags, setTags] = useState(entry.tags?.join(", ") ?? "");
  const [status, setStatus] = useState<ReadingCatalogStatus>(entry.readingStatus ?? "unread");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const savedTags = entry.tags?.join(", ") ?? "";
  useEffect(() => {
    if (dirty) return;
    setCollection(entry.collection ?? "");
    setTags(savedTags);
    setStatus(entry.readingStatus ?? "unread");
  }, [entry.collection, entry.readingStatus, savedTags, dirty]);

  async function invoke(action: (() => void | Promise<void>) | undefined) {
    if (!action) return;
    setBusy(true);
    setMessage("");
    try { await action(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "操作未完成，请重试。"); }
    finally { setBusy(false); }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("已复制。");
    } catch {
      setMessage("复制失败，请选中文字手动复制。");
    }
  }

  async function save() {
    if (!actions.onMetadataChange) return;
    await invoke(async () => {
      await actions.onMetadataChange!(entry.id, {
        collection: collection.trim().slice(0, 80),
        tags: [...new Set(tags.split(/[,，;；\n]/).map((tag) => tag.trim().slice(0, 40)).filter(Boolean))].slice(0, 20),
        readingStatus: status
      });
      setDirty(false);
      setMessage("已保存分类、标签和阅读状态。");
    });
  }

  return <aside className="reading-catalog-details" aria-label="文件元信息">
    <div className="reading-catalog-detail-heading">
      <span className="reading-catalog-eyebrow">{readingCatalogFormatLabels[entry.format]} · {readingCatalogStatusLabels[entry.readingStatus ?? "unread"]}</span>
      <h3>{entry.title}</h3>
      {entry.authors?.length ? <p>{entry.authors.join(" · ")}</p> : null}
    </div>
    <div className="reading-catalog-detail-actions">
      <Button appearance="primary" icon={<OpenRegular />} disabled={busy || entry.available === false} onClick={() => void invoke(() => actions.onOpen(entry))}>开始阅读</Button>
      <Button icon={<CopyRegular />} disabled={busy} onClick={() => void copy(readingCatalogCitation(entry))}>复制引用</Button>
      {actions.onAddToContext ? <Button disabled={busy} onClick={() => void invoke(() => actions.onAddToContext!(entry))}>添加到 Agent 上下文</Button> : null}
      {actions.renderLocation?.(entry)}
    </div>
    {entry.available === false ? <p className="reading-catalog-muted">正文文件暂不可用，仍可查看和整理元信息。</p> : null}
    <dl className="reading-catalog-facts">
      <div><dt>发表年份</dt><dd>{entry.year ?? "未提供"}</dd></div>
      {entry.publishedAt ? <div><dt>发表日期</dt><dd>{entry.publishedAt}</dd></div> : null}
      <div><dt>出版物</dt><dd>{entry.publication || "未提供"}</dd></div>
      {entry.language ? <div><dt>语言</dt><dd>{entry.language}</dd></div> : null}
      <div><dt>文件大小</dt><dd>{formatCatalogFileSize(entry.fileSize)}</dd></div>
      {entry.fileName ? <div><dt>文件名</dt><dd>{entry.fileName}</dd></div> : null}
    </dl>
    {entry.doi ? <CopyValue label="DOI" value={entry.doi} onCopy={(value) => void copy(value)} /> : null}
    {entry.identifier ? <CopyValue label="出版标识" value={entry.identifier} onCopy={(value) => void copy(value)} /> : null}
    <section className="reading-catalog-detail-section" aria-label="文件整理">
      <h4>整理</h4>
      <Field label="分类">
        <Input aria-label="文件分类" maxLength={80} value={collection} disabled={busy || !actions.onMetadataChange} onChange={(_, data) => { setCollection(data.value); setDirty(true); }} />
      </Field>
      <Field label="标签" hint="用逗号分隔，最多 20 个标签。">
        <Input aria-label="文件标签" maxLength={1600} value={tags} disabled={busy || !actions.onMetadataChange} onChange={(_, data) => { setTags(data.value); setDirty(true); }} />
      </Field>
      <Field label="阅读状态">
        <Select aria-label="文件阅读状态" value={status} disabled={busy || !actions.onMetadataChange} onChange={(_, data) => { setStatus(data.value as ReadingCatalogStatus); setDirty(true); }}>
          {Object.entries(readingCatalogStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </Field>
      {actions.onMetadataChange ? <Button disabled={!dirty || busy} onClick={() => void save()}>{busy ? "保存中…" : "保存整理信息"}</Button> : null}
    </section>
    {entry.abstract ? <section className="reading-catalog-detail-section" aria-label="摘要"><h4>摘要</h4><MarkdownContent value={entry.abstract} /></section> : null}
    {entry.physicalPath || entry.liteasyPath || actions.onReveal || (actions.onExport && entry.canExport !== false) ? <section className="reading-catalog-detail-section" aria-label="文件位置">
      <h4>文件与位置</h4>
      {entry.physicalPath ? <CopyValue label="实际位置" value={displayPath(entry.physicalPath)} onCopy={(value) => void copy(value)} /> : null}
      {entry.liteasyPath ? <CopyValue label="Liteasy Path" value={entry.liteasyPath} onCopy={(value) => void copy(value)} /> : null}
      <div className="reading-catalog-detail-actions">
        {actions.onReveal ? <Button icon={<FolderOpenRegular />} disabled={busy} onClick={() => void invoke(() => actions.onReveal!(entry))}>显示实际位置</Button> : null}
        {actions.onExport && entry.canExport !== false ? <Button icon={<ArrowDownloadRegular />} disabled={busy || entry.available === false} onClick={() => void invoke(() => actions.onExport!(entry))}>导出原文件</Button> : null}
      </div>
    </section> : null}
    {actions.onDelete && entry.canRemove !== false ? <Button icon={<DeleteRegular />} disabled={busy} onClick={() => void invoke(() => actions.onDelete!(entry))}>移出阅读库</Button> : null}
    <p role="status" className="reading-catalog-action-status">{message}</p>
  </aside>;
}
