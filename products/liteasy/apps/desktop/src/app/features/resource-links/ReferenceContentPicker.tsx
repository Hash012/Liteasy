import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import { OpenRegular } from "@fluentui/react-icons";
import { ResourceReferencesContext } from "./ResourceReferencesContext";
import { headingReference, referenceFragment, referenceHeadings, referenceLines, type ReferenceRange } from "./referenceText";
import type { ReferenceDocument } from "./resourceReferenceService";
import "./resourceReferences.css";

export function ReferenceContentPicker({ path, fragment = "", onChoose, actionLabel = "插入引用", disabled = false }: {
  path: string; fragment?: string; onChoose(document: ReferenceDocument, range: ReferenceRange): void | Promise<void>; actionLabel?: string; disabled?: boolean;
}) {
  const references = useContext(ResourceReferencesContext);
  const [limit, setLimit] = useState(12000), [attempt, setAttempt] = useState(0);
  const [document, setDocument] = useState<ReferenceDocument>(), [error, setError] = useState("");
  const [selection, setSelection] = useState<ReferenceRange>(), [busy, setBusy] = useState(false), [page, setPage] = useState(0);
  const anchor = useRef<number>();
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { setLimit(12000); setPage(0); setSelection(undefined); anchor.current = undefined; }, [path]);
  useEffect(() => {
    if (!references) return;
    const abort = new AbortController();
    setDocument(undefined); setSelection(undefined); setError("");
    void references.service.document(path, limit, abort.signal).then((value) => {
      if (abort.signal.aborted) return;
      setDocument(value);

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
      const value = referenceLines(document.text, start, end, document.complete);
      const begin = offset(first, range.startContainer, range.startOffset), finish = offset(last, range.endContainer, range.endOffset);
      const text = start === end ? lines[start - 1].slice(begin, finish) : [lines[start - 1].slice(begin), ...lines.slice(start, end - 1), lines[end - 1].slice(0, finish)].join("\n");
      if (text.trim()) { setSelection({ ...value, text, label: `${value.label} · 选中文字` }); setError(""); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function choose() {
    if (!document || !selection || !references || busy) return;
    setBusy(true); setError("");
    try { await references.service.verify(document); await onChoose(document, selection); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <section className="reference-content-picker" aria-label="选择引用内容">
    <header><strong>打开内容</strong><Button size="small" icon={<OpenRegular />} onClick={() => { void Promise.resolve(references?.open(path)).catch((e) => setError(String(e))); }}>打开原文件</Button></header>
    {!document && !error ? <p role="status">正在读取内容…</p> : null}
    {error ? <p role="alert">{error} <Button size="small" onClick={() => setAttempt((value) => value + 1)}>重新载入</Button></p> : null}
    {document ? <>
      <p className="reference-hint">{document.asset.kind === "paper" || document.asset.kind === "source.document" ? "以下为已提取文本的行号。" : "源文本行号，不随显示换行改变。"}点击标题选章节；点击行号、Shift+点击或直接选中文字。</p>
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
      {selection ? <p role="status">{selection.label} · {selection.text.length} 字符</p> : null}
      <Button appearance="primary" disabled={disabled || busy || !selection?.text.trim()} onClick={() => void choose()}>{busy ? "正在添加…" : actionLabel}</Button>
    </> : null}
  </section>;
}
