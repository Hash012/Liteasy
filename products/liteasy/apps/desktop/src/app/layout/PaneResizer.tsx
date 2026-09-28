import { useRef } from "react";

type PaneResizerProps = {
  ariaLabel: string;
  axis?: "horizontal" | "vertical";
  onResize: (deltaPixels: number, containerPixels: number) => void;
};

export function PaneResizer({ ariaLabel, axis = "horizontal", onResize }: PaneResizerProps) {
  const drag = useRef<{ pointerId: number; position: number } | null>(null);
  const containerSize = (element: HTMLElement) => {
    const rect = element.parentElement?.getBoundingClientRect();
    return (axis === "horizontal" ? rect?.width : rect?.height) ?? 0;
  };
  return (
    <div
      aria-label={ariaLabel}
      aria-orientation={axis === "horizontal" ? "vertical" : "horizontal"}
      className={`pane-resizer ${axis}`}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, position: axis === "horizontal" ? event.clientX : event.clientY };
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        const position = axis === "horizontal" ? event.clientX : event.clientY;
        const delta = position - drag.current.position;
        drag.current.position = position;
        onResize(delta, containerSize(event.currentTarget));
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={(event) => {
        const decrease = axis === "horizontal" ? "ArrowLeft" : "ArrowUp";
        const increase = axis === "horizontal" ? "ArrowRight" : "ArrowDown";
        if (event.key !== decrease && event.key !== increase) return;
        event.preventDefault();
        onResize((event.key === increase ? 1 : -1) * (event.shiftKey ? 30 : 10), containerSize(event.currentTarget));
      }}
      role="separator"
      tabIndex={0}
    />
  );
}
