import { InfoPopover } from "../../shared/ui/productPrimitives";
import { useUiTranslation } from "../../shared/i18n/useUiTranslation";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Button, Checkbox } from "@fluentui/react-components";
import { OpenRegular } from "@fluentui/react-icons";
import { ResourceReferencesContext } from "./ResourceReferencesContext";
import { headingReference, referenceCharacters, referenceFragment, referenceHeadings, referenceLines, type ReferenceRange } from "./referenceText";
import type { ReferenceDocument } from "./resourceReferenceService";
import "./resourceReferences.css";
import { subtractContextRanges } from "../context-picker/selectionPlan";
import { referenceSourceStructure, structureSelection } from "../context-picker/sourceStructure";
export type ReferencePickerState = { fragment?: string; page: number; limit: number; revision?: string };

export function ReferenceContentPicker({ path, fragment = "", onChoose, actionLabel = "插入引用", disabled = false, initialState, onStateChange, onChooseRanges }: {
  path: string; fragment?: string; onChoose(document: ReferenceDocument, range: ReferenceRange): void | Promise<void>; actionLabel?: string; disabled?: boolean;
  onChooseRanges?(document: ReferenceDocument, ranges: ReferenceRange[]): Promise<void>;
  initialState?: ReferencePickerState; onStateChange?(state: ReferencePickerState): void;
}) {
  const { tChinese } = useUiTranslation();
  const references = useContext(ResourceReferencesContext);
  const [limit, setLimit] = useState(initialState?.limit ?? 12000), [attempt, setAttempt] = useState(0);
  const [document, setDocument] = useState<ReferenceDocument>(), [error, setError] = useState("");
  const [selection, setSelection] = useState<ReferenceRange>(), [busy, setBusy] = useState(false), [page, setPage] = useState(initialState?.page ?? 0);
  const notifyState = useRef(onStateChange); notifyState.current = onStateChange;
  const [wholeText, setWholeText] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [structureLimit, setStructureLimit] = useState(60);
  const anchor = useRef<number>();
  const cancellation = useRef<AbortController>();
  const prepare = useRef(false);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { setLimit(initialState?.limit ?? 12000); setPage(initialState?.page ?? 0); setSelection(undefined); anchor.current = undefined; }, [path]);
  useEffect(() => {
    if (!references) return;
    const preparation = prepare.current ? "allow" : "cached"; prepare.current = false;
    const abort = new AbortController(); cancellation.current = abort;
    setDocument(undefined); setSelection(undefined); setWholeText(false); setExcluded([]); setError("");
    let readPath = path;
    if (attempt === 0 && initialState?.revision && path.startsWith("liteasy://objects/")) { const pinned = new URL(path); pinned.searchParams.set("revision", initialState.revision); readPath = pinned.href; }
    void references.service.document(readPath, limit, abort.signal, preparation).then((value) => {
      if (abort.signal.aborted) return;
      setDocument(value);
      if (attempt === 0 && initialState?.revision && initialState.revision !== value.asset.revision) setError("来源版本已变化，请重新载入并选择片段。");
      else if (attempt === 0 && initialState?.fragment) try { setSelection(referenceFragment(value.text, initialState.fragment, value.complete)); } catch { setError("原选区暂不可用，请重新选择。"); }

    }).catch((e) => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e)); });
    return () => abort.abort();
  }, [references?.service, path, limit, attempt]);
  useEffect(() => {
    if (!document || !fragment) return;
    try { const selected = referenceFragment(document.text, fragment, document.complete); setSelection(selected); setPage(Math.floor((selected.start - 1) / 200)); setError(""); }
    catch (e) { setSelection(undefined); setError(e instanceof Error ? e.message : String(e)); }
  }, [document, fragment]);
  useEffect(() => references?.service.subscribe(path, () => { setSelection(undefined); setError("源文件已修改，请重新载入并选择片段。"); }), [references?.service, path]);
  const lines = document?.text.split("\n") ?? [];
  const structure = useMemo(() => document ? referenceSourceStructure(document) : [], [document]);
  useEffect(() => {
    if (document) notifyState.current?.({ page, limit, fragment: selection?.fragment, revision: document.asset.revision });
  }, [page, limit, selection?.fragment, document?.asset.revision]);
  const headings = useMemo(() => referenceHeadings(document?.text ?? "", document?.complete), [document]);
  function selectLines(line: number, extend: boolean) {
    if (!document) return;
    if (!extend || !anchor.current) anchor.current = line;
    try { setSelection(referenceLines(document.text, Math.min(anchor.current, line), Math.max(anchor.current, line), document.complete)); setError(""); }
    catch (e) { setError(String(e instanceof Error ? e.message : e)); }
  }
  function selectText() {
    const selected = window.getSelection();
    if (!document || !selected?.rangeCount || selected.isCollapsed || !body.current) return;
    const range = selected.getRangeAt(0);
    const cell = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest<HTMLElement>("[data-reference-line-text]");
    const first = cell(range.startContainer), last = cell(range.endContainer);
    if (!first || !last || !body.current.contains(first) || !body.current.contains(last)) return;
    const offset = (element: HTMLElement, node: Node, end: number) => { const r = window.document.createRange(); r.selectNodeContents(element); r.setEnd(node, end); return r.toString().length; };
    const start = Number(first.dataset.referenceLineText), end = Number(last.dataset.referenceLineText);
    try {
      const begin = offset(first, range.startContainer, range.startOffset), finish = offset(last, range.endContainer, range.endOffset);
      const lineOffset = (line: number) => lines.slice(0, line - 1).reduce((total, value) => total + value.length + 1, 0);
      const value = referenceCharacters(document.text, lineOffset(start) + begin, lineOffset(end) + finish, document.complete);
      if (value.text.trim()) { setSelection(value); setError(""); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function choose() {
    if (!document || (!selection && !wholeText) || !references || busy) return;
    setBusy(true); setError("");
    try {
      await references.service.verify(document);
      if (wholeText && onChooseRanges) {
        if (!document.complete) throw new Error("正文未完整载入，不能计算全文排除范围。");
        const whole = { source: document.asset.path, revision: document.asset.revision ?? "", representation: "text" as const, start: 0, end: document.text.length };
        const ranges = subtractContextRanges(whole, structure.filter(item => excluded.includes(item.id)).map(item => ({ ...whole, start: item.start, end: item.end })));
        const selections = ranges.map(range => referenceCharacters(document.text, range.start, range.end, true)).filter(range => range.text.trim());
        if (!selections.length) throw new Error("已排除全部正文，请至少保留一个片段。");
        await onChooseRanges(document, selections);
      } else if (selection) await onChoose(document, selection);
    }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <section className="reference-content-picker" aria-label="选择引用内容">
    <header><strong>打开内容</strong><Button size="small" icon={<OpenRegular />} onClick={() => { void Promise.resolve(references?.open(path)).catch((e) => setError(String(e))); }}>打开原文件</Button></header>
    {!document && !error ? <p role="status">正在读取内容…<Button size="small" onClick={() => { cancellation.current?.abort(); setError(tChinese("preview.cancelled", "已取消读取。")); }}>{tChinese("preview.cancelRead", "取消读取")}</Button></p> : null}
    {error ? <p role="alert">{error} <Button size="small" onClick={() => setAttempt((value) => value + 1)}>重新载入</Button>{/正文尚未就绪/.test(error) ? <Button size="small" onClick={() => { prepare.current = true; setAttempt((value) => value + 1); }}>{tChinese("preview.prepareText", "解析正文")}</Button> : null}</p> : null}
    {document ? <>
      <p className="reference-hint">{document.asset.kind === "paper" || document.asset.kind === "source.document" ? "以下为已提取文本的行号。" : "源文本行号，不随显示换行改变。"}</p>
      <InfoPopover label={tChinese("reference.selection.help", "选择引用帮助")}><p>{tChinese("reference.selection.guidance", "点击标题选章节；点击行号、Shift+点击或直接选中文字。")}</p></InfoPopover>
      {onChooseRanges && structure.length ? <Checkbox label="选择完整文本，可排除下列片段" disabled={!document.complete || disabled} checked={wholeText} onChange={(_, data) => { setWholeText(data.checked === true); setExcluded([]); }} /> : null}
      {structure.length ? <nav className="reference-heading-list" aria-label="源结构目录">{structure.slice(0, structureLimit).map(item => <div key={item.id}>{wholeText ? <Checkbox aria-label={`排除 ${item.title}`} checked={excluded.includes(item.id)} onChange={(_, data) => setExcluded(values => data.checked ? [...values, item.id] : values.filter(value => value !== item.id))} /> : null}<Button size="small" appearance="subtle" onClick={() => {
        try { const selected = structureSelection(document, item); setSelection(selected); setPage(Math.floor((selected.start - 1) / 200)); setError(""); } catch (error) { setError(String(error)); }
      }}>{item.title}<small>{({ paragraph: "段落", heading: "标题", table: "表格", math: "公式", list: "列表", code: "代码", page: "页" } as Record<string, string>)[item.type] ?? "文本块"}</small></Button></div>)}
        {structure.length > structureLimit ? <Button size="small" onClick={() => setStructureLimit(value => value + 60)}>更多结构片段</Button> : null}
      </nav> : null}
      {headings.length ? <nav className="reference-heading-list" aria-label="引用标题目录">{headings.map((heading) => <Button key={heading.line} size="small" appearance="subtle" style={{ paddingLeft: 6 + (heading.level - 1) * 8 }}
        onClick={() => { try { setSelection(headingReference(document.text, heading, document.complete)); setPage(Math.floor((heading.line - 1) / 200)); setError(""); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }}>
        {heading.title}<small>L{heading.line}–{heading.endLine}{!heading.complete ? " · 尚未完整" : ""}</small></Button>)}</nav> : null}
      <div ref={body} className="reference-numbered-lines" aria-label="带行号的原文" onMouseUp={selectText}>
        {lines.slice(page * 200, (page + 1) * 200).map((line, index) => { const number = page * 200 + index + 1; return <div key={number} className={selection && number >= selection.start && number <= selection.end ? "is-selected" : ""}>
          <button type="button" aria-label={`选择第 ${number} 行`} aria-pressed={Boolean(selection && number >= selection.start && number <= selection.end)} onClick={(event) => selectLines(number, event.shiftKey)}>{number}</button>
          <span data-reference-line-text={number}>{line || "\u200b"}</span></div>; })}
      </div>
      {lines.length > 200 ? <div className="reference-pagination"><Button size="small" disabled={!page} onClick={() => setPage((value) => value - 1)}>前 200 行</Button><span>{page * 200 + 1}–{Math.min((page + 1) * 200, lines.length)}</span><Button size="small" disabled={(page + 1) * 200 >= lines.length} onClick={() => setPage((value) => value + 1)}>后 200 行</Button></div> : null}
      {!document.complete ? <div><small>仅载入部分正文，尾部章节可能不完整。</small><Button size="small" disabled={limit >= 80000} onClick={() => setLimit((value) => Math.min(80000, value + 12000))}>继续载入</Button>{limit >= 80000 ? <p>已达单次内容上限，请打开原文件选择较小片段。</p> : null}</div> : null}
      {wholeText ? <p role="status">完整文本 · 已排除 {excluded.length} 个结构片段</p> : null}
      {selection ? <p role="status">{selection.label} · {selection.text.length} 字符</p> : null}
      <Button appearance="primary" disabled={disabled || busy || (!wholeText && !selection?.text.trim())} onClick={() => void choose()}>{busy ? "正在添加…" : actionLabel}</Button>
    </> : null}
  </section>;
}
