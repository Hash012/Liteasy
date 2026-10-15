import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";

function instantScroll(root: HTMLElement, left: number, top: number) {
  if (typeof root.scrollTo === "function") root.scrollTo({ left, top, behavior: "instant" });
  else { root.scrollLeft = left; root.scrollTop = top; }
}

type Anchor = { page: number; x: number; y: number; viewportX: number; viewportY: number };
function viewport(root: HTMLElement) {
  const rect = root.getBoundingClientRect();
  return { left: rect.left + root.clientLeft, top: rect.top + root.clientTop,
    width: root.clientWidth || rect.width, height: root.clientHeight || rect.height };
}

/** Preserve one PDF point near the reading line through layout/zoom changes. */
export function usePdfViewportAnchor(stage: RefObject<HTMLElement>, frame: RefObject<HTMLElement>, options: {
  enabled: boolean; document: unknown; focusedPage: number; zoom: number; width: number; layout: string;
}) {
  const latest = useRef(options); latest.current = options;
  const lifetime = useMemo(() => ({ anchor: undefined as Anchor | undefined, captureFrame: 0, restoreFrame: 0,
    navigating: false, target: undefined as Anchor | undefined,
    navigationTimer: undefined as ReturnType<typeof setTimeout> | undefined }), [options.document]);
  const capture = useCallback(() => {
    const root = stage.current;
    if (!root || !latest.current.enabled || lifetime.navigating) return;
    const page = latest.current.focusedPage;
    const bounds = root.querySelector<HTMLElement>(`.pdf-page-shell[data-page="${page}"]`)?.getBoundingClientRect();
    const view = viewport(root);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0 || bounds.bottom <= view.top || bounds.top >= view.top + view.height) return;
    const x = Math.max(bounds.left, Math.min(bounds.right, view.left + view.width / 2));
    const y = Math.max(bounds.top, Math.min(bounds.bottom, view.top + Math.min(64, view.height / 3)));
    lifetime.anchor = { page, x: (x - bounds.left) / bounds.width, y: (y - bounds.top) / bounds.height,
      viewportX: (x - view.left) / view.width, viewportY: y - view.top };
  }, [stage, lifetime]);
  const restore = useCallback(() => {
    const root = stage.current, anchor = lifetime.anchor;
    if (!root || !latest.current.enabled || lifetime.navigating) return;
    if (!anchor) { capture(); return; }
    const bounds = root.querySelector<HTMLElement>(`.pdf-page-shell[data-page="${anchor.page}"]`)?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
    const view = viewport(root);
    const dx = bounds.left + bounds.width * anchor.x - view.left - view.width * anchor.viewportX;
    const dy = bounds.top + bounds.height * anchor.y - view.top - anchor.viewportY;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) instantScroll(root, root.scrollLeft + dx, root.scrollTop + dy);
  }, [stage, lifetime, capture]);
  const settleNavigation = useCallback(() => {
    lifetime.navigating = false;
    if (lifetime.target) { lifetime.anchor = lifetime.target; lifetime.target = undefined; restore(); }
    else capture();
  }, [lifetime, restore, capture]);
  useLayoutEffect(() => { restore(); }, [restore, options.enabled, options.zoom, options.width, options.layout]);
  // The viewport observer and scroll capture share a frame. React may commit the
  // newly visible page after that capture, so replace the old page's anchor now.
  useLayoutEffect(() => { capture(); }, [capture, options.focusedPage]);
  useEffect(() => {
    const root = stage.current;
    if (!root || !options.enabled) return;
    const scroll = () => {
      if (lifetime.navigating) {
        clearTimeout(lifetime.navigationTimer);
        lifetime.navigationTimer = setTimeout(settleNavigation, 150);
        return;
      }
      if (lifetime.restoreFrame || lifetime.captureFrame) return;
      lifetime.captureFrame = requestAnimationFrame(() => { lifetime.captureFrame = 0; capture(); });
    };
    const resize = () => {
      cancelAnimationFrame(lifetime.captureFrame); lifetime.captureFrame = 0;
      if (!lifetime.restoreFrame) lifetime.restoreFrame = requestAnimationFrame(() => { lifetime.restoreFrame = 0; restore(); });
    };
    const intent = () => {
      clearTimeout(lifetime.navigationTimer); lifetime.navigating = false; lifetime.target = undefined;
      instantScroll(root, root.scrollLeft, root.scrollTop);
      cancelAnimationFrame(lifetime.restoreFrame); lifetime.restoreFrame = 0; capture();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(root); if (frame.current) observer.observe(frame.current);
    root.addEventListener("scroll", scroll, { passive: true });
    root.addEventListener("wheel", intent, { passive: true });
    root.addEventListener("pointerdown", intent, { passive: true });
    capture();
    return () => {
      observer.disconnect(); cancelAnimationFrame(lifetime.captureFrame); cancelAnimationFrame(lifetime.restoreFrame);
      clearTimeout(lifetime.navigationTimer);
      root.removeEventListener("scroll", scroll); root.removeEventListener("wheel", intent); root.removeEventListener("pointerdown", intent);
    };
  }, [stage, frame, options.enabled, lifetime, capture, restore, settleNavigation]);
  return { capture() {
    clearTimeout(lifetime.navigationTimer); lifetime.navigating = false; lifetime.target = undefined;
    const root = stage.current; if (root) instantScroll(root, root.scrollLeft, root.scrollTop); capture();
  }, reset(page?: number, topRatio = 0) {
    lifetime.anchor = undefined;
    lifetime.target = page === undefined ? undefined : { page, x: 0, y: topRatio, viewportX: 0, viewportY: 0 };
    lifetime.navigating = true;
    clearTimeout(lifetime.navigationTimer);
    lifetime.navigationTimer = setTimeout(settleNavigation, 150);
    cancelAnimationFrame(lifetime.captureFrame); lifetime.captureFrame = 0;
    cancelAnimationFrame(lifetime.restoreFrame); lifetime.restoreFrame = 0;
  } };
}
