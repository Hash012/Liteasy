import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Slider } from "@fluentui/react-components";
import { ArrowLeftRegular } from "@fluentui/react-icons";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfAnnotationV2 } from "./pdfAnnotationStorage";
import { PdfThumbnail } from "./PdfThumbnail";

export function thumbnailWindow(count: number, width: number, height: number, scrollTop: number, tileWidth: number, pageRatio = 1.45) {
  const columns = Math.max(1, Math.floor(Math.max(0, width - 24) / (tileWidth + 16)));
  const rowHeight = Math.ceil(tileWidth * pageRatio) + 42;
  const rows = Math.ceil(count / columns);
  const firstRow = Math.max(0, Math.min(rows - 1, Math.floor(scrollTop / rowHeight)) - 2);
  const endRow = Math.min(rows, firstRow + Math.ceil(Math.max(1, height) / rowHeight) + 5);
  return { columns, rowHeight, first: firstRow * columns, end: Math.min(count, endRow * columns), top: firstRow * rowHeight, height: rows * rowHeight };
}

export function PdfPagesOverview({ document, count, currentPage, annotations, onNavigate, onClose }: {
  document: PDFDocumentProxy | null; count: number; currentPage: number; annotations: PdfAnnotationV2[];
  onNavigate(page: number): void; onClose(): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [tileWidth, setTileWidth] = useState(160);
  const [viewport, setViewport] = useState({ width: 800, height: 600, top: 0 });
  const initialized = useRef(false);
  const [pageRatio, setPageRatio] = useState(1.45);
  useEffect(() => {
    let cancelled = false;
    if (document) void document.getPage(1).then((page) => {
      const viewport = page.getViewport({ scale: 1 });
      if (!cancelled) {
        initialized.current = false;
        setPageRatio(Math.max(.5, Math.min(1.6, viewport.height / viewport.width)));
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [document]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const update = () => {
      setViewport({ width: element.clientWidth, height: element.clientHeight, top: element.scrollTop });
    };
    if (!initialized.current) {
      const range = thumbnailWindow(count, element.clientWidth || 800, element.clientHeight || 600, 0, tileWidth, pageRatio);
      element.scrollTop = Math.floor((currentPage - 1) / range.columns) * range.rowHeight;
      initialized.current = true;
    }
    update();
    const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  }, [count, tileWidth, pageRatio]);
  const pageAnnotations = useMemo(() => {
    const map = new Map<number, PdfAnnotationV2[]>();
    for (const annotation of annotations) {
      const items = map.get(annotation.page);
      if (items) items.push(annotation); else map.set(annotation.page, [annotation]);
    }
    return map;
  }, [annotations]);
  const range = thumbnailWindow(count, viewport.width, viewport.height, viewport.top, tileWidth, pageRatio);
  const pages = Array.from({ length: Math.max(0, range.end - range.first) }, (_, index) => range.first + index + 1);
  return <section className="pdf-overview pdf-pages-overview" aria-label="全部页面缩略图">
    <header className="pdf-overview-header">
      <Button appearance="subtle" icon={<ArrowLeftRegular />} onClick={onClose}>返回 PDF</Button>
      <strong>Pages · {count} 页</strong>
      <Slider aria-label="缩略图大小" min={110} max={260} step={10} value={tileWidth} onChange={(_, data) => setTileWidth(data.value)} />
    </header>
    <div className="pdf-pages-scroll" ref={root} onScroll={(event) => { const top = event.currentTarget.scrollTop; setViewport((current) => ({ ...current, top })); }}>
      <div style={{ height: range.height, position: "relative" }}>
        <ol className="pdf-pages-grid" style={{ top: range.top, gridTemplateColumns: `repeat(${range.columns}, minmax(0, 1fr))`, gridAutoRows: range.rowHeight }}>
          {pages.map((page) => <PdfThumbnail key={page} pageNumber={page} pdfDocument={document} width={tileWidth} maxHeight={tileWidth * pageRatio}
            annotations={pageAnnotations.get(page) ?? []} active={page === currentPage} onNavigate={onNavigate} />)}
        </ol>
      </div>
    </div>
  </section>;
}
