import { useEffect, useRef, useState, type RefObject, type PointerEvent, type MouseEvent, type KeyboardEvent } from "react";
import type { Placement } from "../objects/object.types";
const editable = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest("input,textarea,select,[contenteditable=true]"));
type Box = { left: number; top: number; width: number; height: number };
export function useCanvasNavigation(input: { viewport: RefObject<HTMLDivElement>; canvas: RefObject<HTMLDivElement>; zoom: number; setZoom(value: number): void;
  visible: boolean; boardId?: string; placements: Placement[]; selected: string[]; setSelected(ids: string[]): void;
  create(position: Placement["position"]): Promise<unknown>; remove(id: string): Promise<unknown>; error(failure: unknown): void }) {
  const latest = useRef(input); latest.current = input;
  const space = useRef(false);
  const gesture = useRef<{ pointer: number; x: number; y: number; left: number; top: number; pan: boolean; selected: string[] }>();
  const [marquee, setMarquee] = useState<Box>();
  useEffect(() => {
    const up = (event: globalThis.KeyboardEvent) => { if (event.code === "Space") space.current = false; };
    const blur = () => { space.current = false; gesture.current = undefined; setMarquee(undefined); };
    const down = (event: globalThis.KeyboardEvent) => {
      if (event.code === "Space" && !editable(event.target) && latest.current.viewport.current?.contains(event.target as Node)) {
        space.current = true; event.preventDefault();
      }
    };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);
  useEffect(() => { gesture.current = undefined; setMarquee(undefined); space.current = false; }, [input.boardId, input.visible]);
  useEffect(() => {
    const host = input.viewport.current;
    if (!host || !input.visible) return;
    const wheel = (event: WheelEvent) => {
      if (editable(event.target)) return;
      if (!(event.ctrlKey || event.metaKey || space.current)) {
        if (event.shiftKey) { event.preventDefault(); host.scrollLeft += event.deltaY || event.deltaX; }
        return;
      }
      event.preventDefault();
      const current = latest.current;
      const zoom = Math.max(0.25, Math.min(2, current.zoom * Math.exp(-event.deltaY * 0.002)));
      const bounds = host.getBoundingClientRect();
      const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
      const left = (host.scrollLeft + x - 56) * zoom / current.zoom + 56 - x;
      const top = (host.scrollTop + y - 56) * zoom / current.zoom + 56 - y;
      current.setZoom(zoom);
      requestAnimationFrame(() => { host.scrollLeft = left; host.scrollTop = top; });
    };
    host.addEventListener("wheel", wheel, { passive: false });
    return () => host.removeEventListener("wheel", wheel);
  }, [input.visible]);
  function point(x: number, y: number) { const element = input.canvas.current!; const bounds = element.getBoundingClientRect(); const scale = bounds.width / Number.parseFloat(element.style.width) || input.zoom; return { x: Math.max(0, (x - bounds.left) / scale), y: Math.max(0, (y - bounds.top) / scale) }; }
  const blank = (target: EventTarget) => target instanceof Element && !target.closest(".object-placement,button,a,input,textarea,.object-board-edge");
  function finish(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointer !== event.pointerId) return;
    gesture.current = undefined; setMarquee(undefined);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }
  function fitSelection() {
    const host = input.viewport.current;
    const items = input.placements.filter((p) => input.selected.includes(p.placementId));
    if (!host || !items.length) return;
    const left = Math.min(...items.map((p) => p.position.x)), top = Math.min(...items.map((p) => p.position.y));
    const width = Math.max(...items.map((p) => p.position.x + p.size.width)) - left;
    const height = Math.max(...items.map((p) => p.position.y + p.size.height)) - top;
    const zoom = Math.max(0.25, Math.min(2, (host.clientWidth - 100) / width, (host.clientHeight - 100) / height));
    input.setZoom(zoom);
    requestAnimationFrame(() => host.scrollTo({ left: Math.max(0, 56 + (left + width / 2) * zoom - host.clientWidth / 2), top: Math.max(0, 56 + (top + height / 2) * zoom - host.clientHeight / 2) }));
  }
  return { marquee, fitSelection,
    onKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
      if (event.currentTarget.contains(event.target as Node) && !(event.target as Element).closest("button") && event.code === "Space" && !editable(event.target)) { space.current = true; event.preventDefault(); event.stopPropagation(); }
    },
    onPointerDownCapture(event: PointerEvent<HTMLDivElement>) {
      if (!event.currentTarget.contains(event.target as Node) || editable(event.target) || !input.canvas.current) return;
      const pan = event.button === 1 || (event.button === 0 && space.current);
      if (!pan && (event.button !== 0 || !blank(event.target))) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
      const start = pan ? { x: event.clientX, y: event.clientY } : point(event.clientX, event.clientY);
      gesture.current = { pointer: event.pointerId, ...start, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop, pan, selected: event.shiftKey ? input.selected : [] };
      if (!pan && !event.shiftKey) input.setSelected([]);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMoveCapture(event: PointerEvent<HTMLDivElement>) {
      const drag = gesture.current; if (!drag || drag.pointer !== event.pointerId) return;
      event.stopPropagation();
      if (drag.pan) { event.currentTarget.scrollLeft = drag.left - event.clientX + drag.x; event.currentTarget.scrollTop = drag.top - event.clientY + drag.y; return; }
      const end = point(event.clientX, event.clientY);
      const box = { left: Math.min(drag.x, end.x), top: Math.min(drag.y, end.y), width: Math.abs(end.x - drag.x), height: Math.abs(end.y - drag.y) };
      setMarquee(box);
      const ids = [...new Set([...drag.selected, ...input.placements.filter((p) => p.position.x < box.left + box.width && p.position.x + p.size.width > box.left && p.position.y < box.top + box.height && p.position.y + p.size.height > box.top).map((p) => p.placementId)])];
      if (ids.length !== input.selected.length || ids.some((id, index) => id !== input.selected[index])) input.setSelected(ids);
    }, onPointerUpCapture: finish,
    onDoubleClick(event: MouseEvent<HTMLDivElement>) { if (event.currentTarget.contains(event.target as Node) && blank(event.target) && input.canvas.current) { event.preventDefault(); void input.create(point(event.clientX, event.clientY)).catch(input.error); } },
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      if (!event.currentTarget.contains(event.target as Node) || editable(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); input.setSelected(input.placements.map((p) => p.placementId)); }
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); const ids = [...input.selected]; void (async () => { for (const id of ids) await input.remove(id); input.setSelected([]); })().catch(input.error); }
    },
  };
}
