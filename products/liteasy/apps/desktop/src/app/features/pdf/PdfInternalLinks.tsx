import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ResourceLink } from "../resource-links/ResourceReferenceView";
import { resolvePdfBookmark, type PdfBookmarkTarget, type PdfOutlineItem } from "./pdfBookmarkDestination";
import "./pdfInternalLinks.css";

const PdfSourcePreview = lazy(() => import("./PdfSourcePreview"));
type InternalLink = {
  id: string;
  destination: PdfOutlineItem["dest"];
  rect: { left: number; top: number; width: number; height: number };
};

/** PDF annotations use PDF coordinates; the viewport handles rotation and CropBox offsets. */
export function PdfInternalLinks({ document, pageNumber, onNavigate }: {
  document: PDFDocumentProxy; pageNumber: number; onNavigate(target: PdfBookmarkTarget): void;
}) {
  const [loaded, setLoaded] = useState<{ document: PDFDocumentProxy; page: number; links: InternalLink[] }>();
  useEffect(() => {
    let active = true;
    void (async () => {
      const page = await document.getPage(pageNumber);
      const annotations = await page.getAnnotations({ intent: "display" });
      const viewport = page.getViewport({ scale: 1 });
      const links: InternalLink[] = annotations.flatMap((annotation, index) => {
        if (annotation.subtype !== "Link" || !annotation.dest || annotation.url || annotation.unsafeUrl ||
          !Array.isArray(annotation.rect) || annotation.rect.length !== 4 || !annotation.rect.every(Number.isFinite)) return [];
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(annotation.rect);
        const left = Math.max(0, Math.min(x1, x2)), top = Math.max(0, Math.min(y1, y2));
        const width = Math.min(viewport.width, Math.max(x1, x2)) - left;
        const height = Math.min(viewport.height, Math.max(y1, y2)) - top;
        if (width <= 0 || height <= 0) return [];
        return [{ id: annotation.id ?? String(index), destination: annotation.dest,
          rect: { left: left / viewport.width * 100, top: top / viewport.height * 100,
            width: width / viewport.width * 100, height: height / viewport.height * 100 } }];
      });
      if (active) setLoaded({ document, page: pageNumber, links });
    })().catch(() => { if (active) setLoaded(undefined); });
    return () => { active = false; };
  }, [document, pageNumber]);
  if (loaded?.document !== document || loaded.page !== pageNumber) return null;
  return <div className="pdf-internal-links" aria-label={`第 ${pageNumber} 页内部链接`}>
    {loaded.links.map(link => <InternalLinkView key={link.id} document={document} link={link} onNavigate={onNavigate} />)}
  </div>;
}

function InternalLinkView({ document, link, onNavigate }: {
  document: PDFDocumentProxy; link: InternalLink; onNavigate(target: PdfBookmarkTarget): void;
}) {
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  return <span className="pdf-internal-link" style={Object.fromEntries(Object.entries(link.rect).map(([key, value]) => [key, `${value}%`]))}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <ResourceLink locator={`pdf-internal:${link.id}`} ariaLabel="跳转到 PDF 内部位置" closeOnOpen
      onOpen={async () => {
        const target = await resolvePdfBookmark(document, link.destination);
        if (active.current) onNavigate(target);
      }}
      preview={<InternalLinkPreview document={document} destination={link.destination} />}>
      <span aria-hidden="true" />
    </ResourceLink>
  </span>;
}

function InternalLinkPreview({ document, destination }: { document: PDFDocumentProxy; destination: PdfOutlineItem["dest"] }) {
  const [target, setTarget] = useState<PdfBookmarkTarget>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void resolvePdfBookmark(document, destination).then(value => { if (active) setTarget(value); })
      .catch(() => { if (active) setError("无法读取此 PDF 内部链接的目标位置。"); });
    return () => { active = false; };
  }, [document, destination]);
  if (error) return <span role="alert">{error}</span>;
  if (!target) return <span role="status">正在读取 PDF 链接目标…</span>;
  const documentKey = document.fingerprints?.[0] ?? "current-pdf";
  return <Suspense fallback={<span role="status">正在载入 PDF 预览…</span>}>
    <PdfSourcePreview pdfDocument={document} source={{ path: documentKey, documentKey, page: target.page,
      target: { documentKey, page: target.page, precision: "page", topRatio: target.topRatio } }} />
  </Suspense>;
}
