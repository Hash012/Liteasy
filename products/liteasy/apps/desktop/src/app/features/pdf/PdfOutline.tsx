import { useEffect, useRef, useState } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { resolvePdfBookmark, type PdfOutlineItem, type PdfBookmarkTarget } from "./pdfBookmarkDestination";

export function PdfOutline({ document, onNavigate }: { document: PDFDocumentProxy | null; onNavigate(target: PdfBookmarkTarget): void }) {
  const current = useRef(document); current.current = document;
  const request = useRef(0);
  const [state, setState] = useState<{ document: PDFDocumentProxy | null; items: PdfOutlineItem[]; error?: string }>({ document: null, items: [] });
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    request.current += 1; setMessage("");
    if (!document) return;
    setState({ document: null, items: [] });
    void Promise.resolve().then(() => document.getOutline?.() ?? []).then((items) => {
      if (!cancelled) setState({ document, items: items ?? [] });
    }).catch(() => { if (!cancelled) setState({ document, items: [], error: "目录读取失败，请重试。" }); });
    return () => { cancelled = true; request.current += 1; };
  }, [document, attempt]);

  async function navigate(item: PdfOutlineItem) {
    if (!document) return;
    const id = ++request.current;
    try {
      const target = await resolvePdfBookmark(document, item.dest);
      if (current.current === document && request.current === id) { setMessage(""); onNavigate(target); }
    } catch (error) { if (current.current === document && request.current === id) setMessage(error instanceof Error ? error.message : "无法跳转到此书签。"); }
  }
  function renderItems(items: PdfOutlineItem[], path = "", depth = 0): React.ReactNode {
    if (depth > 32) return <li>目录层级过深。</li>;
    return items.map((item, index) => <li key={`${path}/${index}`}>
      {item.items?.length ? <details open={depth === 0}>
        <summary>{item.title || "未命名章节"}</summary>
        {item.dest ? <Button appearance="subtle" size="small" onClick={() => void navigate(item)}>跳转到 {item.title || "本章"}</Button> : null}
        <ol>{renderItems(item.items, `${path}/${index}`, depth + 1)}</ol>
      </details> : <button type="button" className="pdf-outline-link" disabled={!item.dest}
        title={item.dest ? item.title : "此条目没有文档内跳转位置"} onClick={() => void navigate(item)}>{item.title || "未命名书签"}</button>}
    </li>);
  }
  return <nav className="pdf-outline" aria-label="PDF 书签目录">
    {!document || state.document !== document ? <Spinner size="tiny" label="正在读取目录…" />
      : state.error ? <><p role="alert">{state.error}</p><Button onClick={() => setAttempt((value) => value + 1)}>重试读取目录</Button></>
        : state.items.length ? <ol>{renderItems(state.items)}</ol> : <p>此 PDF 没有内置书签。可使用缩略图定位页面。</p>}
    {message ? <p role="status">{message}</p> : null}
  </nav>;
}
