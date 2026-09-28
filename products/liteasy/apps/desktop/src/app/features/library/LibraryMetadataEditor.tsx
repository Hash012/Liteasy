import { useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Select, Textarea } from "@fluentui/react-components";
import type { ReadingCatalogEntry, ReadingCatalogMetadataPatch } from "./readingCatalog.types";
import { assetTypeLabels, inferAssetType } from "./libraryAssetMetadata";

export function LibraryMetadataEditor({ entry, onSave, onClose }: { entry: ReadingCatalogEntry; onSave: (patch: ReadingCatalogMetadataPatch) => Promise<void>; onClose: () => void }) {
  const [type, setType] = useState(entry.assetType || inferAssetType(entry.format));
  const [year, setYear] = useState(entry.year ? String(entry.year) : "");
  const [authors, setAuthors] = useState(entry.authors?.join("; ") ?? "");
  const [subjects, setSubjects] = useState(entry.subjects?.join(", ") ?? "");
  const [tags, setTags] = useState(entry.tags?.join(", ") ?? "");
  const [collection, setCollection] = useState(entry.collection ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const split = (value: string, separator: RegExp) => [...new Set(value.split(separator).map((part) => part.trim()).filter(Boolean))];
  async function save() {
    const publishedYear = year.trim() ? Number(year) : undefined;
    if (publishedYear !== undefined && (!/^\d{4}$/.test(year.trim()) || publishedYear < 1000)) { setError("年份请填写四位数字，或留空。"); return; }
    setPending(true); setError("");
    try {
      await onSave({ assetType: type, year: publishedYear, authors: split(authors, /[;；\n]/),
        subjects: split(subjects, /[,，;；\n]/).slice(0, 20), tags: split(tags, /[,，\n]/).slice(0, 20), collection: collection.trim() });
      onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setPending(false); }
  }
  return <Dialog open onOpenChange={(_, data) => { if (!data.open && !pending) onClose(); }}>
    <DialogSurface aria-label="编辑资产分类与标签" className="library-metadata-dialog"><form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <DialogBody><DialogTitle>分类与标签</DialogTitle><DialogContent className="library-metadata-editor">
        <strong>{entry.title}</strong>
        <div className="library-metadata-fields">
          <Field label="类别"><Select autoFocus aria-label="资产类别" value={type} disabled={pending} onChange={(_, data) => setType(data.value)}>
            <option value="">未分类</option>{Object.entries(assetTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select></Field>
          <Field label="年份"><Input aria-label="资产年份" value={year} disabled={pending} onChange={(_, data) => setYear(data.value)} maxLength={4} placeholder="例如 2024" /></Field>
        </div>
        <Field label="作者"><Input aria-label="资产作者" value={authors} disabled={pending} onChange={(_, data) => setAuthors(data.value)} placeholder="多位作者用分号分隔" maxLength={2000} /></Field>
        <Field label="学科"><Input aria-label="资产学科" value={subjects} disabled={pending} onChange={(_, data) => setSubjects(data.value)} placeholder="例如：计算机科学, 机器学习" maxLength={1200} /></Field>
        <Field label="分类"><Input aria-label="资产分类" value={collection} disabled={pending} onChange={(_, data) => setCollection(data.value)} placeholder="例如：待读 / 项目资料" maxLength={80} /></Field>
        <Field label="标签"><Textarea aria-label="资产标签" value={tags} disabled={pending} onChange={(_, data) => setTags(data.value)} placeholder="用逗号或换行分隔，最多 20 个标签" maxLength={900} resize="vertical" /></Field>
        <small>用于整理、显示和筛选；不会改变已经确认的正式题录。</small>
        {error ? <div role="alert">{error}</div> : null}
      </DialogContent><DialogActions><Button disabled={pending} onClick={onClose}>取消</Button><Button type="submit" appearance="primary" disabled={pending}>保存</Button></DialogActions></DialogBody>
    </form></DialogSurface>
  </Dialog>;
}
