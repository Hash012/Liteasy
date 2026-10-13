import { useEffect, useRef, useState } from "react";
import { Button, Spinner, Tree, TreeItem, TreeItemLayout } from "@fluentui/react-components";
import { BookmarkRegular } from "@fluentui/react-icons";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { resolvePdfBookmark, type PdfOutlineItem, type PdfBookmarkTarget } from "./pdfBookmarkDestination";

export function PdfOutline({ document, onNavigate }: { document: PDFDocumentProxy | null; onNavigate(target: PdfBookmarkTarget): void }) {
  const current = useRef(document); current.current = document;
  const request = useRef(0);
  const [state, setState] = useState<{ document: PDFDocumentProxy | null; items: PdfOutlineItem[]; error?: string }>({ document: null, items: [] });
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState("");
  const [resolvedPages, setResolvedPages] = useState<Record<string, number>>({});
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    request.current += 1; setMessage(""); setSelected(""); setResolvedPages({}); setOpenItems(new Set());
    if (!document) return;
    setState({ document: null, items: [] });
    void Promise.resolve().then(() => document.getOutline?.() ?? []).then((items) => {
      if (!cancelled) {
        setState({ document, items: items ?? [] });
        setOpenItems(new Set((items ?? []).flatMap((item, index) => item.items?.length ? [`/${index}`] : [])));
      }
    }).catch(() => { if (!cancelled) setState({ document, items: [], error: "目录读取失败，请重试。" }); });
    return () => { cancelled = true; request.current += 1; };
  }, [document, attempt]);

  async function navigate(item: PdfOutlineItem, id: string) {
    if (!document) return;
    const requestId = ++request.current;
    try {
      const target = await resolvePdfBookmark(document, item.dest);
      if (current.current === document && request.current === requestId) { setMessage(""); setSelected(id); setResolvedPages((pages) => ({ ...pages, [id]: target.page })); onNavigate(target); }
    } catch (error) { if (current.current === document && request.current === requestId) setMessage(error instanceof Error ? error.message : "无法跳转到此书签。"); }
  }
  function renderItems(items: PdfOutlineItem[], path = "", depth = 0): React.ReactNode {
    if (depth > 32) return <TreeItem itemType="leaf" value={`${path}/depth-limit`}><TreeItemLayout>目录层级过深。</TreeItemLayout></TreeItem>;
    return items.map((item, index) => {
      const id = `${path}/${index}`;
      const branch = Boolean(item.items?.length);
      const directPage = Array.isArray(item.dest) && Number.isInteger(item.dest[0]) && item.dest[0] >= 0 && item.dest[0] < (document?.numPages ?? 0) ? item.dest[0] + 1 : undefined;
      const page = resolvedPages[id] ?? directPage;
      return <TreeItem key={id} value={id} itemType={branch ? "branch" : "leaf"}
        aria-label={item.title || "未命名章节"} aria-current={selected === id ? "location" : undefined}
        onClick={(event) => { event.preventDefault(); if (item.dest) void navigate(item, id); }}>
        <TreeItemLayout iconBefore={<BookmarkRegular />} aside={page ? <span className="pdf-outline-page" aria-label={`第 ${page} 页`}>{page}</span> : undefined}
          title={item.dest ? item.title : "此条目没有文档内跳转位置"}>
          <span className="pdf-outline-title">{item.title || "未命名章节"}</span>
        </TreeItemLayout>
        {branch ? <Tree>{renderItems(item.items, id, depth + 1)}</Tree> : null}
      </TreeItem>;
    });
  }
  return <nav className="pdf-outline" aria-label="PDF 书签目录">
    {!document || state.document !== document ? <Spinner size="tiny" label="正在读取目录…" />
      : state.error ? <><p role="alert">{state.error}</p><Button onClick={() => setAttempt((value) => value + 1)}>重试读取目录</Button></>
        : state.items.length ? <Tree aria-label="文档章节" size="small" openItems={openItems}
          onOpenChange={(_, data) => setOpenItems(new Set([...data.openItems].map(String)))}>{renderItems(state.items)}</Tree> : <p>此 PDF 没有内置书签。可使用缩略图定位页面。</p>}
    {message ? <p role="status">{message}</p> : null}
  </nav>;
}
