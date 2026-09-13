import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { PdfAnnotationV2 } from "./pdfAnnotationStorage";
import type { PdfInkMode, PdfInkPoint, PdfInkStroke } from "./pdfInk";

export function PdfInkLayer({ annotations, mode, color, width, aspectRatio, onCreate, onDelete }: {
  annotations: PdfAnnotationV2[]; mode: PdfInkMode; color: string; width: number; aspectRatio: number;
  onCreate: (stroke: PdfInkStroke) => void; onDelete: (annotation: PdfAnnotationV2) => void;
}) {
  const drag = useRef<{ pointerId: number; points: PdfInkPoint[] } | null>(null);
  const [preview, setPreview] = useState<PdfInkPoint[]>([]);
  useEffect(() => { drag.current = null; setPreview([]); }, [mode]);
  const point = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)),
      y: Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)) };
  };
  const path = (points: PdfInkPoint[]) => points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y * aspectRatio}`).join(" ") +
    (points.length === 1 ? ` l0.001,0` : "");
  return <svg aria-label="PDF 手绘图层" className={`pdf-ink-layer ${mode ? "is-drawing" : ""}`}
    viewBox={`0 0 100 ${100 * aspectRatio}`} preserveAspectRatio="none"
    onPointerDown={(event) => {
      if (!mode) return;
      event.stopPropagation(); event.preventDefault();
      if (mode !== "draw" || event.button !== 0 || event.isPrimary === false) return;
      drag.current = { pointerId: event.pointerId, points: [point(event)] };
      setPreview(drag.current.points);
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      if (!drag.current || drag.current.pointerId !== event.pointerId) return;
      const next = point(event); const previous = drag.current.points.at(-1)!;
      if (Math.hypot(next.x - previous.x, next.y - previous.y) < .08 || drag.current.points.length >= 11999) return;
      drag.current.points.push(next); setPreview([...drag.current.points]);
    }}
    onPointerUp={(event) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.stopPropagation(); current.points.push(point(event)); drag.current = null; setPreview([]);
      onCreate({ points: current.points, color, width });
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => { drag.current = null; setPreview([]); }}
  >
    {annotations.map((annotation) => annotation.ink ? <path key={annotation.id} d={path(annotation.ink.points)}
      aria-label="手绘笔迹" fill="none" stroke={annotation.ink.color} strokeWidth={annotation.ink.width}
      strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: mode === "erase" ? "stroke" : "none", cursor: "crosshair" }}
      onPointerDown={(event) => { if (mode === "erase") { event.stopPropagation(); event.preventDefault(); onDelete(annotation); } }}
    /> : null)}
    {preview.length > 0 ? <path d={path(preview)} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" /> : null}
  </svg>;
}
