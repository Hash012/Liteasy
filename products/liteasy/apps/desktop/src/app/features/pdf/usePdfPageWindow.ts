import { useEffect, useRef, useState, type RefObject } from "react";
import { pdfPagesInViewport } from "./pdfRenderBudget";
import { pdfVisiblePage } from "./pdfVisiblePage";

export function usePdfPageWindow(stage: RefObject<HTMLElement>, frame: RefObject<HTMLElement>, options: {
  enabled: boolean; document: unknown; focusedPage: number; pageCount: number; layout: string; zoom: number; width: number;
  onVisiblePage?(page: number, topRatio: number): void;
}) {
  const [pages, setPages] = useState<ReadonlySet<number>>(() => new Set([1]));
  const latest = useRef(options); latest.current = options;
  const refresh = useRef<() => void>();
  useEffect(() => {
    const root = stage.current;
    if (!root || !options.enabled) { setPages(new Set()); return; }
    let request = 0;
    let dirty = true;
    let scrolled = false;
    let measuredScrollHeight = -1;
    let entries: { page: number; top: number; bottom: number }[] = [];
    const measure = () => {
      request = 0;
      const viewport = root.getBoundingClientRect();
      const scrollHeight = root.scrollHeight;
      if (dirty || scrollHeight !== measuredScrollHeight) {
        // Native scroll anchoring may report a new scrollTop before ResizeObserver
        // reports a late PDF page-size change. Never combine it with stale bounds.
        entries = Array.from(root.querySelectorAll<HTMLElement>(".pdf-page-shell"), (element) => {
          const rect = element.getBoundingClientRect();
          return { page: Number(element.dataset.page), top: rect.top - viewport.top + root.scrollTop,
            bottom: rect.bottom - viewport.top + root.scrollTop, width: rect.width };
        }).filter((entry) => Number.isSafeInteger(entry.page) && entry.page > 0 && entry.width > 0 && entry.bottom > entry.top);
        dirty = false;
        measuredScrollHeight = scrollHeight;
      }
      const top = root.scrollTop + root.clientTop;
      const bottom = top + (root.clientHeight || viewport.height);
      const visible = bottom > top ? pdfPagesInViewport(entries, top, bottom) : [];
      // jsdom supplies no layout, but still exercises annotation UI on page placeholders.
      const next = new Set(visible);
      setPages((previous) => previous.size === next.size && [...previous].every((page, index) => visible[index] === page) ? previous : next);
      if (scrolled && bottom > top && entries.length) {
        const page = latest.current.layout === "continuous" ? pdfVisiblePage({ top, bottom }, entries, latest.current.focusedPage) : latest.current.focusedPage;
        const bounds = entries.find((entry) => entry.page === page);
        const topRatio = bounds ? Math.round(Math.min(1, (top - bounds.top) / (bounds.bottom - bounds.top)) * 100_000) / 100_000 : 0;
        latest.current.onVisiblePage?.(page, topRatio);
      }
      scrolled = false;
    };
    const schedule = () => { if (!request) request = requestAnimationFrame(measure); };
    const invalidate = () => { dirty = true; schedule(); };
    const scroll = () => { scrolled = true; schedule(); };
    refresh.current = invalidate;
    measure();
    root.addEventListener("scroll", scroll, { passive: true });
    const observer = new ResizeObserver(invalidate);
    observer.observe(root);
    if (frame.current) observer.observe(frame.current);
    root.querySelectorAll(".pdf-page-shell").forEach((page) => observer.observe(page));
    return () => { refresh.current = undefined; cancelAnimationFrame(request); observer.disconnect(); root.removeEventListener("scroll", scroll); };
  }, [stage, frame, options.enabled, options.document, options.pageCount, options.layout, options.zoom, options.width]);
  useEffect(() => { if (options.layout !== "continuous") refresh.current?.(); }, [options.focusedPage, options.layout]);
  return options.enabled ? pages : new Set<number>();
}
