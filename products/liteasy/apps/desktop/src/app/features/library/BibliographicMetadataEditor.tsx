import { ActionButton as Button, DisclosureSection, OptionPicker } from "../../shared/ui/productPrimitives";
import { useState } from "react";
import { ContentView } from "../markdown/ContentView";
import { legacyContent } from "../markdown/contentFragment";
import { displayPath } from "../resource-filesystem/displayPath";
import { Field, Input, Textarea, Tooltip } from "@fluentui/react-components";
import { AddRegular, ArrowClockwiseRegular, CopyRegular, EditRegular, DeleteRegular, SaveRegular } from "@fluentui/react-icons";
import { bibliographicFields, bibliographicFieldLabel, bibliographicTypeFields, type BibliographicDraft } from "./bibliographicFields";
import { assetTypeLabels } from "./libraryAssetMetadata";
import { readingCatalogCitation } from "./readingCatalogSearch";
import type { ReadingCatalogEntry } from "./readingCatalog.types";
import "./bibliographicMetadataEditor.css";

export type BibliographicEditorModel = {
  editing?: boolean; followSelection?: boolean; edit?(): void; finishEditing?(): void; setFollowSelection?(value: boolean): void;
  entry?: ReadingCatalogEntry; draft?: BibliographicDraft; dirty: boolean; pending: boolean; error: string; message: string;
  change(patch: Partial<BibliographicDraft>): void; reload(): void; save(): Promise<void>;
};
export function BibliographicMetadataEditor({ model }: { model: BibliographicEditorModel }) {
  const { entry, draft, pending } = model;
  const [copyStatus, setCopyStatus] = useState("");
  if (!entry || !draft) return <section className="bibliographic-editor-empty"><p>选中文献后，使用右键菜单或底部信息栏的“编辑元信息”。</p></section>;
  const relation = <div className="bibliographic-relation"><span>文献信息</span>{model.setFollowSelection ? <OptionPicker aria-label="信息关联方式" density="compact" value={model.followSelection ? "follow" : "pinned"} disabled={pending} onValueChange={value => model.setFollowSelection?.(value === "follow")} options={[{ value: "follow", label: "跟随所选文献" }, { value: "pinned", label: "固定到此文献" }]} /> : <span>固定到此文献</span>}</div>;
  if (model.editing === false) return <section className="bibliographic-summary" aria-label="文献信息">
    {relation}<div className="bibliographic-summary-body">
      <p className="bibliographic-kicker">{[assetTypeLabels[draft.assetType] || draft.assetType || entry.format.toUpperCase(), draft.publishedAt].filter(Boolean).join(" · ")}</p>
      <h2>{draft.title}</h2><p className="bibliographic-summary-authors">{draft.authors.join(" · ") || "尚未填写作者"}</p>
      {draft.publication ? <p>{draft.publication}</p> : null}
      <p className="bibliographic-kicker">{entry.fileName || entry.format.toUpperCase()}</p>
      <div className="bibliographic-summary-actions"><Button icon={<EditRegular />} onClick={model.edit}>编辑元信息</Button><Button icon={<CopyRegular />} onClick={async () => { try { await navigator.clipboard.writeText(readingCatalogCitation({ ...entry, ...draft })); setCopyStatus("引用已复制"); } catch { setCopyStatus("复制失败，请重试"); } }}>复制引用</Button></div>
      {copyStatus || model.message ? <p role="status">{copyStatus || model.message}</p> : null}
      <DisclosureSection className="bibliographic-summary-section" title="摘要">{draft.abstract ? <ContentView content={legacyContent(draft.abstract)}  /> : <p>暂无摘要。可以在编辑元信息中补充。</p>}</DisclosureSection>
      <DisclosureSection className="bibliographic-summary-section" title="标识符与出版信息"><dl>{bibliographicFields.filter(({ key }) => !["title", "abstract", "publication", "publishedAt", "extra"].includes(key) && draft[key]).map(({ key }) => <div key={key}><dt>{bibliographicFieldLabel(key, draft.assetType)}</dt><dd>{draft[key]}</dd></div>)}</dl></DisclosureSection>
      <DisclosureSection className="bibliographic-summary-section" title="附件与所在文库"><p>{entry.fileName || "未记录文件名"}</p><p>{entry.folderPath || entry.collection || "本地文献库"}</p>{entry.physicalPath ? <p>{displayPath(entry.physicalPath)}</p> : null}</DisclosureSection>
    </div>
  </section>;
  const field = (key: typeof bibliographicFields[number]["key"]) => {
    const definition = bibliographicFields.find((item) => item.key === key)!;
    const label = bibliographicFieldLabel(key, draft.assetType);
    const props = { "aria-label": label, value: draft[key], maxLength: definition.limit, disabled: pending };
    return <Field key={key} label={label} className={"multiline" in definition ? "bibliographic-field is-multiline" : "bibliographic-field"}>
      {"multiline" in definition
        ? <Textarea {...props} rows={key === "title" ? 3 : 5} resize="vertical" onChange={(_, data) => model.change({ [key]: data.value })} />
        : <Input {...props} placeholder={"placeholder" in definition ? definition.placeholder : undefined} onChange={(_, data) => model.change({ [key]: data.value })} />}
    </Field>;
  };
  const primaryFields = bibliographicTypeFields(draft.assetType);
  const additionalFields = bibliographicFields.filter(({ key }) => key !== "title" && key !== "abstract" && !primaryFields.includes(key));
  return <form className="bibliographic-editor" aria-label="编辑文献元信息" onSubmit={(event) => { event.preventDefault(); void model.save(); }}>
    {relation}
    <header><h2>{entry.title}</h2><span>{entry.fileName || entry.format.toUpperCase()}</span></header>
    <div className="bibliographic-editor-fields">
      <Field label="条目类型" className="bibliographic-field"><OptionPicker aria-label="条目类型" disabled={pending} value={draft.assetType} onValueChange={value => model.change({ assetType: value })} options={[{ value: "", label: "未分类" }, ...(!assetTypeLabels[draft.assetType] && draft.assetType ? [{ value: draft.assetType, label: draft.assetType }] : []), ...Object.entries(assetTypeLabels).map(([value, label]) => ({ value, label }))]} /></Field>
      {field("title")}
      <section className="bibliographic-authors" aria-label="作者列表">
        <div className="bibliographic-section-heading"><strong>作者</strong><Tooltip content="添加作者" relationship="description"><Button type="button" appearance="subtle" size="small" icon={<AddRegular />} aria-label="添加作者" disabled={pending || draft.authors.length >= 200} onClick={() => model.change({ authors: [...draft.authors, ""] })} /></Tooltip></div>
        {draft.authors.map((author, index) => <div className="bibliographic-author" key={index}>
          <Input aria-label={`作者 ${index + 1}`} value={author} disabled={pending} maxLength={300} placeholder="姓名（如 Kleppmann, Martin）" onChange={(_, data) => model.change({ authors: draft.authors.map((value, i) => i === index ? data.value : value) })} />
          <Tooltip content="移除此作者" relationship="description"><Button type="button" aria-label={`移除作者 ${index + 1}`} disabled={pending} size="small" appearance="subtle" icon={<DeleteRegular />} onClick={() => model.change({ authors: draft.authors.filter((_, i) => i !== index) })} /></Tooltip>
        </div>)}
        {!draft.authors.length ? <small>尚未填写作者</small> : null}
      </section>
      {primaryFields.map(field)}
      {field("abstract")}
      <DisclosureSection key={draft.assetType} defaultOpen={additionalFields.some(({ key }) => Boolean(draft[key]))} className="bibliographic-extra-fields" title="更多信息">{additionalFields.map(({ key }) => field(key))}</DisclosureSection>
    </div>
    <footer>
      {model.error ? <p role="alert">{model.error}</p> : <p role="status">{model.dirty ? "有未保存的更改" : model.message}</p>}
      <div>{model.finishEditing ? <Button type="button" disabled={pending || model.dirty} onClick={model.finishEditing}>查看信息</Button> : null}<Button type="button" icon={<ArrowClockwiseRegular />} disabled={pending} onClick={model.reload}>重新载入</Button>
        <Button type="submit" appearance="primary" icon={<SaveRegular />} disabled={pending || !model.dirty}>{pending ? "保存中…" : "保存元信息"}</Button></div>
    </footer>
  </form>;
}
