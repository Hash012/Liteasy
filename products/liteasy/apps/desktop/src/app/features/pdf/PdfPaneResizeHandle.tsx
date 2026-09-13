import { useRef } from "react";

export function PdfPaneResizeHandle({ width, onChange }: { width: number; onChange: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  return <div
    aria-label="调整白板宽度" aria-orientation="vertical" aria-valuemin={220}
    aria-valuemax={900} aria-valuenow={width} role="separator" tabIndex={0}
    className="pdf-whiteboard-resizer" title="拖动调整白板宽度，也可使用方向键"
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag.current = { x: event.clientX, width };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      if (!drag.current) return;
      const available = event.currentTarget.closest(".pdf-workspace")?.getBoundingClientRect().width ?? 1200;
      onChange(Math.max(220, Math.min(900, available - 280, drag.current.width + drag.current.x - event.clientX)));
    }}
    onPointerUp={(event) => {
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => { if (drag.current) onChange(drag.current.width); drag.current = null; }}
    onKeyDown={(event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      onChange(Math.max(220, Math.min(900, width + (event.key === "ArrowLeft" ? 20 : -20))));
    }}
  />;
}
