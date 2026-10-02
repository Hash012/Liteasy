import { Button, Field, Input, Select, Textarea, Tooltip } from "@fluentui/react-components";
import { AddRegular, ArrowClockwiseRegular, DeleteRegular, SaveRegular } from "@fluentui/react-icons";
import { bibliographicFields, type BibliographicDraft } from "./bibliographicFields";
import { assetTypeLabels } from "./libraryAssetMetadata";
import type { ReadingCatalogEntry } from "./readingCatalog.types";
import "./bibliographicMetadataEditor.css";

export type BibliographicEditorModel = {
  entry?: ReadingCatalogEntry; draft?: BibliographicDraft; dirty: boolean; pending: boolean; error: string; message: string;
  change(patch: Partial<BibliographicDraft>): void; reload(): void; save(): Promise<void>;
};
export function BibliographicMetadataEditor({ model }: { model: BibliographicEditorModel }) {
  const { entry, draft, pending } = model;
  if (!entry || !draft) return <section className="bibliographic-editor-empty"><p>选中文献后，使用右键菜单或底部信息栏的“编辑元信息”。</p></section>;
  const field = (key: typeof bibliographicFields[number]["key"]) => {
    const definition = bibliographicFields.find((item) => item.key === key)!;
    const props = { "aria-label": definition.label, value: draft[key], maxLength: definition.limit, disabled: pending };
    return <Field key={key} label={definition.label} className={"multiline" in definition ? "bibliographic-field is-multiline" : "bibliographic-field"}>
      {"multiline" in definition
        ? <Textarea {...props} rows={key === "title" ? 3 : 5} resize="vertical" onChange={(_, data) => model.change({ [key]: data.value })} />
        : <Input {...props} placeholder={"placeholder" in definition ? definition.placeholder : undefined} onChange={(_, data) => model.change({ [key]: data.value })} />}
    </Field>;
  };
  return <form className="bibliographic-editor" aria-label="编辑文献元信息" onSubmit={(event) => { event.preventDefault(); void model.save(); }}>
    <header><h2>{entry.title}</h2><span>{entry.fileName || entry.format.toUpperCase()}</span></header>
    <div className="bibliographic-editor-fields">
      <Field label="条目类型" className="bibliographic-field"><Select aria-label="条目类型" disabled={pending} value={draft.assetType} onChange={(_, data) => model.change({ assetType: data.value })}>
        <option value="">未分类</option>{!assetTypeLabels[draft.assetType] && draft.assetType ? <option value={draft.assetType}>{draft.assetType}</option> : null}
        {Object.entries(assetTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select></Field>
      {field("title")}
      <section className="bibliographic-authors" aria-label="作者列表">
        <div className="bibliographic-section-heading"><strong>作者</strong><Tooltip content="添加作者" relationship="description"><Button type="button" appearance="subtle" size="small" icon={<AddRegular />} aria-label="添加作者" disabled={pending || draft.authors.length >= 200} onClick={() => model.change({ authors: [...draft.authors, ""] })} /></Tooltip></div>
        {draft.authors.map((author, index) => <div className="bibliographic-author" key={index}>
          <Input aria-label={`作者 ${index + 1}`} value={author} disabled={pending} maxLength={300} placeholder="姓名（如 Kleppmann, Martin）" onChange={(_, data) => model.change({ authors: draft.authors.map((value, i) => i === index ? data.value : value) })} />
          <Tooltip content="移除此作者" relationship="description"><Button type="button" aria-label={`移除作者 ${index + 1}`} disabled={pending} size="small" appearance="subtle" icon={<DeleteRegular />} onClick={() => model.change({ authors: draft.authors.filter((_, i) => i !== index) })} /></Tooltip>
        </div>)}
        {!draft.authors.length ? <small>尚未填写作者</small> : null}
      </section>
      {field("publishedAt")}{field("publication")}
      <details open={draft.assetType === "book" || undefined} className="bibliographic-extra-fields"><summary>出版信息</summary>
        {(["publisher", "place", "volume", "issue", "pages", "edition", "series", "seriesNumber"] as const).map(field)}
      </details>
      {(["doi", "isbn", "issn", "url", "language"] as const).map(field)}
      {field("abstract")}
      <details className="bibliographic-extra-fields"><summary>更多信息</summary>{(["shortTitle", "accessedAt", "extra"] as const).map(field)}</details>
    </div>
    <footer>
      {model.error ? <p role="alert">{model.error}</p> : <p role="status">{model.dirty ? "有未保存的更改" : model.message}</p>}
      <div><Button type="button" icon={<ArrowClockwiseRegular />} disabled={pending} onClick={model.reload}>重新载入</Button>
        <Button type="submit" appearance="primary" icon={<SaveRegular />} disabled={pending || !model.dirty}>{pending ? "保存中…" : "保存元信息"}</Button></div>
    </footer>
  </form>;
}
