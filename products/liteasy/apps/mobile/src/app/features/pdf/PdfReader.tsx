import { useEffect, useRef, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Spinner, Tooltip } from "@fluentui/react-components";
import { ArrowLeftRegular, ChevronLeftRegular, ChevronRightRegular, ZoomInRegular, ZoomOutRegular, SearchRegular, BookOpenRegular, InfoRegular } from "@fluentui/react-icons";
import type { LibraryItem } from "../library/library.types";
import type { PdfReaderState } from "./pdfReader.types";
import { PdfPage } from "./PdfPage";
import { searchPdf, type SearchMatch } from "./pdfEngine";
import type { AnnotationControls, AnnotationMode } from "../annotations/annotation.types";
import { AnnotationLayer } from "../annotations/AnnotationLayer";
import { AnnotationTools, type AnnotationEditor } from "../annotations/AnnotationTools";
import { useBackHandler } from "../navigation/backNavigation";
import { ReflowPage } from "./ReflowPage";

export default function PdfReader({ item, reader, annotations, onClose, onDetails }: {
  item: LibraryItem; reader: PdfReaderState; annotations: AnnotationControls; onClose: () => void; onDetails: () => void;
}) {
  const readerRef = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<AnnotationMode>("select");
  const [editor, setEditor] = useState<AnnotationEditor>();
  const [panel, setPanel] = useState<"search" | "outline">();
  const [reflow, setReflow] = useState(false);
  useBackHandler(Boolean(panel), () => setPanel(undefined), 40);
  useBackHandler(mode !== "select", () => setMode("select"), 30);
  useBackHandler(reflow, () => setReflow(false), 35);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchedPages, setSearchedPages] = useState(0);
  const [password, setPassword] = useState("");
  const [pageInput, setPageInput] = useState(String(reader.page));
  const search = useRef<AbortController>();
  useEffect(() => { setPageInput(String(reader.page)); }, [reader.page]);
  useEffect(() => () => search.current?.abort(), []);
  const runSearch = async () => {
    if (!reader.document) return;
    search.current?.abort();
    const controller = new AbortController(); search.current = controller;
    setSearching(true); setSearched(false); setSearchError(""); setSearchedPages(0); setMatches([]);
    try {
      const result = await searchPdf(reader.document, query, controller.signal, (page) => {
        if (!controller.signal.aborted) setSearchedPages(page);
      });
      if (!controller.signal.aborted) { setMatches(result); setSearched(true); }
    } catch (reason) { if (!controller.signal.aborted) setSearchError(String(reason)); }
    finally { if (!controller.signal.aborted) setSearching(false); }
  };
  return <section ref={readerRef} className="pdf-reader" aria-label={`阅读 ${item.title}`}>
    <div className="reader-heading">
      <Tooltip content="返回资料库" relationship="label"><Button icon={<ArrowLeftRegular />} aria-label="返回资料库" onClick={onClose} /></Tooltip>
      <strong>{item.title}</strong>
      <Tooltip content="资料详情" relationship="label"><Button icon={<InfoRegular />} aria-label="资料详情" onClick={onDetails} /></Tooltip>
    </div>
    {reader.error ? <p className="error-message" role="alert">{reader.error}</p> : null}
    {!reader.document && !reader.passwordRequired && !reader.error ? <Spinner label="正在打开 PDF…" /> : null}
    {reader.document ? <>
      <div className="reader-toolbar" role="toolbar" aria-label="阅读工具">
        <Tooltip content="上一页" relationship="label"><Button aria-label="上一页" icon={<ChevronLeftRegular />} disabled={reader.page === 1} onClick={() => reader.navigate(reader.page - 1)} /></Tooltip>
        <form onSubmit={(event) => { event.preventDefault(); reader.navigate(Number(pageInput)); }} className="page-jump">
          <Input aria-label="页码" inputMode="numeric" value={pageInput} onChange={(_, data) => setPageInput(data.value)} onBlur={() => {
            if (pageInput.trim()) reader.navigate(Number(pageInput)); else setPageInput(String(reader.page));
          }} /><span>/ {reader.document.numPages}</span>
        </form>
        <Tooltip content="下一页" relationship="label"><Button aria-label="下一页" icon={<ChevronRightRegular />} disabled={reader.page === reader.document.numPages} onClick={() => reader.navigate(reader.page + 1)} /></Tooltip>
        <Tooltip content="缩小" relationship="label"><Button aria-label="缩小" icon={<ZoomOutRegular />} disabled={reader.zoom <= 0.5} onClick={() => reader.setZoom(Math.max(0.5, reader.zoom - 0.25))} /></Tooltip>
        <Button aria-label="适应宽度" onClick={() => reader.setZoom(1)}>{Math.round(reader.zoom * 100)}%</Button>
        <Tooltip content="放大" relationship="label"><Button aria-label="放大" icon={<ZoomInRegular />} disabled={reader.zoom >= 4} onClick={() => reader.setZoom(Math.min(4, reader.zoom + 0.25))} /></Tooltip>
        <Tooltip content="搜索 PDF" relationship="label"><Button aria-label="搜索 PDF" icon={<SearchRegular />} aria-pressed={panel === "search"} onClick={() => setPanel(panel === "search" ? undefined : "search")} /></Tooltip>
        <Tooltip content="目录" relationship="label"><Button aria-label="目录" icon={<BookOpenRegular />} aria-pressed={panel === "outline"} onClick={() => setPanel(panel === "outline" ? undefined : "outline")} /></Tooltip>
        <Button aria-pressed={reflow} onClick={() => { setReflow(!reflow); setMode("select"); }}>{reflow ? "原页阅读" : "文本重排"}</Button>
      </div>
      {panel === "outline" ? <section className="reader-panel" aria-label="PDF 目录"><h2>目录</h2>
        {!reader.outline.length ? <p>此 PDF 未提供目录。</p> : <ul>{reader.outline.map((entry, index) => <li key={index} style={{ marginLeft: `${entry.depth * 12}px` }}>
          <button onClick={() => { reader.navigate(entry.page); setPanel(undefined); }}>{entry.title} · {entry.page}</button>
        </li>)}</ul>}
      </section> : null}
      {panel === "search" ? <section className="reader-panel" aria-label="PDF 搜索">
        <form className="reader-search" onSubmit={(event) => { event.preventDefault(); void runSearch(); }}>
          <Input aria-label="搜索 PDF 内容" value={query} onChange={(_, data) => setQuery(data.value)} />
          <Button type="submit" disabled={!query.trim()}>搜索</Button>
          {searching ? <Button onClick={() => { search.current?.abort(); setSearching(false); }}>停止搜索</Button> : null}
        </form>
        {searching ? <p role="status">正在搜索第 {searchedPages} / {reader.document.numPages} 页…</p> : searched ? <p role="status">{matches.length ? `找到 ${matches.length}${matches.length === 100 ? " 个结果（显示前 100 个）" : " 个结果"}` : "未找到文字。扫描件可能没有可搜索的文字层。"}</p> : null}
        {searchError ? <p role="alert">{searchError}</p> : null}
        <ul>{matches.map((match, index) => <li key={index}><button onClick={() => { reader.navigate(match.page); setPanel(undefined); }}>第 {match.page} 页：{match.excerpt}</button></li>)}</ul>
      </section> : null}
      {!reflow ? <AnnotationTools controls={annotations} mode={mode} setMode={setMode} page={reader.page} readerRef={readerRef} editor={editor} setEditor={setEditor} navigate={reader.navigate} /> : null}
      {reflow ? <ReflowPage document={reader.document} page={reader.page} onOriginal={() => setReflow(false)} /> : <PdfPage document={reader.document} pageNumber={reader.page} zoom={reader.zoom} onZoom={reader.setZoom} pinchEnabled={mode === "select"}>
        <AnnotationLayer key={reader.page} page={reader.page} mode={mode} controls={annotations}
          onPlace={(point) => setEditor({ point, page: reader.page, kind: mode === "text" ? "text" : "note" })}
          onEdit={(existing) => setEditor({ existing, page: existing.page, kind: existing.kind === "text" ? "text" : "note" })} />
      </PdfPage>}
    </> : null}
    <Dialog open={reader.passwordRequired} onOpenChange={(_, data) => { if (!data.open) onClose(); }}><DialogSurface><DialogBody><DialogTitle>此 PDF 需要密码</DialogTitle>
      <DialogContent><Field label="PDF 密码"><Input type="password" value={password} onChange={(_, data) => setPassword(data.value)} /></Field></DialogContent>
      <DialogActions><Button onClick={onClose}>关闭文档</Button><Button appearance="primary" onClick={() => { reader.unlock(password); setPassword(""); }}>打开</Button></DialogActions>
    </DialogBody></DialogSurface></Dialog>
  </section>;
}
