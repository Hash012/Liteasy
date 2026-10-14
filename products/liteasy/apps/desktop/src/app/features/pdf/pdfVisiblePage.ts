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
