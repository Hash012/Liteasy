import { useEffect, useState, type RefObject } from "react";
import { pdfPagesInViewport } from "./pdfRenderBudget";

export function usePdfPageWindow(stage: RefObject<HTMLElement>, frame: RefObject<HTMLElement>, options: {
  enabled: boolean; document: unknown; focusedPage: number; pageCount: number; layout: string; zoom: number; width: number;
}) {
  const [pages, setPages] = useState<ReadonlySet<number>>(() => new Set([1]));
  useEffect(() => {
    const root = stage.current;
    if (!root || !options.enabled) { setPages(new Set()); return; }
    let request = 0;
    const measure = () => {
      request = 0;
      const viewport = root.getBoundingClientRect();
      const entries = Array.from(root.querySelectorAll<HTMLElement>(".pdf-page-shell"), (element) => {
        const rect = element.getBoundingClientRect();
        return { page: Number(element.dataset.page), top: rect.top, bottom: rect.bottom, width: rect.width };
      }).filter((entry) => entry.width > 0 && entry.bottom > entry.top);
      const visible = viewport.height > 0 ? pdfPagesInViewport(entries, viewport.top, viewport.bottom) : [];
      // jsdom supplies no layout, but still exercises annotation UI on page placeholders.
      const next = new Set(visible);
      setPages((previous) => previous.size === next.size && [...previous].every((page) => next.has(page)) ? previous : next);
    };
    const schedule = () => { if (!request) request = requestAnimationFrame(measure); };
    measure();
    root.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    if (frame.current) observer.observe(frame.current);
    return () => { cancelAnimationFrame(request); observer.disconnect(); root.removeEventListener("scroll", schedule); };
  }, [stage, frame, options.enabled, options.document, options.focusedPage, options.pageCount, options.layout, options.zoom, options.width]);
  return options.enabled ? pages : new Set<number>();
}
