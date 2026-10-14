import { useEffect, useRef, useState, type RefObject } from "react";
/** Fixed row geometry keeps accumulated results while bounding mounted rows. */
export function usePickerViewport(root: RefObject<HTMLElement>, count: number, view: "list" | "gallery", queryKey: string, anchorIndex: number) {
  const [metrics, setMetrics] = useState({ top: Math.max(0, anchorIndex) * 64, height: 720, width: 600 });
  const timer = useRef(0);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const measure = () => {
      cancelAnimationFrame(timer.current);
      timer.current = requestAnimationFrame(() => setMetrics({ top: node.scrollTop, height: node.clientHeight || 720, width: node.clientWidth || 600 }));
    };
    measure(); node.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => { cancelAnimationFrame(timer.current); observer.disconnect(); node.removeEventListener("scroll", measure); };
  }, [root]);
  useEffect(() => { if (root.current && anchorIndex < 0) root.current.scrollTop = 0; }, [queryKey]);
  const columns = view === "gallery" ? Math.max(1, Math.floor(metrics.width / 240)) : 1;
  const height = view === "gallery" ? 176 : 64;
  const start = count <= 60 ? 0 : Math.max(0, Math.min(Math.floor(Math.max(0, metrics.top - 110) / height) - 6, Math.ceil(count / columns) - 1)) * columns;
  const end = count <= 60 ? count : Math.min(count, start + (Math.ceil(metrics.height / height) + 14) * columns);
  return { start, end, top: Math.floor(start / columns) * height, bottom: Math.ceil((count - end) / columns) * height };
}
