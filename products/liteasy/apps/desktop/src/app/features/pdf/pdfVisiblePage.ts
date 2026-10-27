type PageBounds = { page: number; top: number; bottom: number };

/** A short final page cannot always scroll to the viewport's top edge. */
export function pdfVisiblePage(viewport: { top: number; bottom: number }, pages: PageBounds[], currentPage: number) {
  if (viewport.bottom <= viewport.top) return currentPage;
  const current = pages.find((page) => page.page === currentPage);
  // Keep explicit navigation when several short pages fit entirely on screen.
  if (current && current.top >= viewport.top - 1 && current.bottom <= viewport.bottom + 1) return currentPage;
  let selected = currentPage;
  let mostVisible = 0;
  for (const page of pages) {
    const visible = Math.max(0, Math.min(page.bottom, viewport.bottom) - Math.max(page.top, viewport.top));
    if (visible > mostVisible || (visible > 0 && visible === mostVisible && page.page === currentPage)) {
      mostVisible = visible;
      selected = page.page;
    }
  }
  return selected;
}

/** Sample fresh bounds before closing; a pending animation frame can lag behind the last wheel event. */
export function readPdfViewportPosition(stage: HTMLElement | null, currentPage: number, layout: string) {
  if (!stage || !stage.clientHeight || !stage.clientWidth) return undefined;
  const top = stage.getBoundingClientRect().top + stage.clientTop;
  const entries = Array.from(stage.querySelectorAll<HTMLElement>(".pdf-page-shell"), element => {
    const bounds = element.getBoundingClientRect();
    return { page: Number(element.dataset.page), top: bounds.top, bottom: bounds.bottom, width: bounds.width };
  }).filter(entry => entry.width > 0 && entry.bottom > entry.top);
  const page = layout === "continuous" ? pdfVisiblePage({ top, bottom: top + stage.clientHeight }, entries, currentPage) : currentPage;
  const bounds = entries.find(entry => entry.page === page);
  return bounds ? { page, topRatio: Math.round(Math.min(1, (top - bounds.top) / (bounds.bottom - bounds.top)) * 100_000) / 100_000 } : undefined;
}
