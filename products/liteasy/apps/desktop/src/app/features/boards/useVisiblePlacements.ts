import { useEffect, useMemo, useState, type RefObject } from "react";
import type { Placement } from "../objects/object.types";
export function visibleBoardPlacements(placements: Placement[], rect: { left: number; top: number; width: number; height: number }, selected: readonly string[], max = 80) {
  const selectedSet = new Set(selected);
  const inside = (item: Placement) => item.position.x + item.size.width >= rect.left && item.position.x <= rect.left + rect.width && item.position.y + item.size.height >= rect.top && item.position.y <= rect.top + rect.height;
  const pinned = placements.filter((item) => selectedSet.has(item.placementId)).slice(0, max);
  return [...pinned, ...placements.filter((item) => !selectedSet.has(item.placementId) && inside(item)).slice(0, Math.max(0, max - pinned.length))];
}
export function useVisiblePlacements(placements: Placement[], viewport: RefObject<HTMLDivElement>, zoom: number, selected: string[], enabled: boolean) {
  const [rect, setRect] = useState({ left: 0, top: 0, width: 1800, height: 1400 });
  useEffect(() => {
    const element = viewport.current; if (!element || !enabled) return;
    let frame = 0;
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setRect({ left: element.scrollLeft / zoom - 400, top: element.scrollTop / zoom - 400, width: (element.clientWidth || 1200) / zoom + 800, height: (element.clientHeight || 900) / zoom + 800 })); };
    update(); element.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update); observer?.observe(element);
    return () => { cancelAnimationFrame(frame); element.removeEventListener("scroll", update); observer?.disconnect(); };
  }, [viewport, zoom, enabled]);
  return useMemo(() => enabled ? visibleBoardPlacements(placements, rect, selected) : [], [placements, rect, selected, enabled]);
}
