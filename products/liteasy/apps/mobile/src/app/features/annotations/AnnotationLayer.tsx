import { useRef, useState, type PointerEvent } from "react";
import { pdfInkBounds, pdfInkStrokes, type PdfInkPoint, type PdfInkStroke } from "@liteasy/reading-core/pdfInk";
import type { PdfAnnotationV2 } from "@liteasy/reading-core/pdfAnnotations";
import { pagePoint } from "./annotationGeometry";
import type { AnnotationControls, AnnotationMode } from "./annotation.types";

const colors = { yellow: "#fff100", red: "#f15b50", blue: "#2196f3", green: "#4caf50", pink: "#e573b3" };
const path = (points: PdfInkPoint[]) => points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
export function AnnotationLayer({ page, mode, controls, onPlace, onEdit }: {
  page: number; mode: AnnotationMode; controls: AnnotationControls;
  onPlace: (point: PdfInkPoint) => void; onEdit: (annotation: PdfAnnotationV2) => void;
}) {
  const [preview, setPreview] = useState<PdfInkPoint[]>([]);
  const stroke = useRef<{ pointer: number; points: PdfInkPoint[] }>();
  const pointerPoint = (event: PointerEvent<SVGSVGElement>) => pagePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
  const cancel = () => { stroke.current = undefined; setPreview([]); };
  return <div className={`annotation-layer mode-${mode}`}>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="annotation-canvas" aria-label="PDF 批注图层"
      style={{ pointerEvents: mode === "select" || !controls.ready ? "none" : "auto", touchAction: mode === "select" ? "auto" : "none" }}
      onPointerDown={(event) => {
        if (!controls.ready || mode === "select") return;
        if (!event.isPrimary || stroke.current) { cancel(); return; }
        if (event.button !== 0) return;
        if (mode === "erase") {
          const id = (event.target as Element).closest("[data-annotation-id]")?.getAttribute("data-annotation-id");
          if (id) void controls.remove(id); return;
        }
        if (mode === "note" || mode === "text") { onPlace(pointerPoint(event)); return; }
        const point = pointerPoint(event); stroke.current = { pointer: event.pointerId, points: [point] }; setPreview([point]);
        event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (!stroke.current || event.pointerId !== stroke.current.pointer) return;
        const point = pointerPoint(event), last = stroke.current.points.at(-1)!;
        if (Math.hypot(point.x - last.x, point.y - last.y) < 0.08 || stroke.current.points.length >= 12000) return;
        stroke.current.points.push(point); setPreview([...stroke.current.points]);
      }}
      onPointerUp={(event) => {
        if (stroke.current?.pointer !== event.pointerId) return;
        const points = [...stroke.current.points, pointerPoint(event)].slice(0, 12000);
        const ink: PdfInkStroke = { points, color: "#075ea8", width: 0.35 };
        cancel();
        void controls.add({ kind: "ink", page, ink, inkStrokes: [ink], rects: [pdfInkBounds(ink)] });
      }} onPointerCancel={cancel} onLostPointerCapture={cancel}>
      {controls.annotations.filter((value) => value.page === page).map((value) => <g key={value.id} data-annotation-id={value.id}>
        {value.kind === "ink" ? pdfInkStrokes(value).map((ink, index) => <path key={index} d={path(ink.points)} fill="none" stroke={ink.color} strokeWidth={ink.width} strokeLinecap="round" strokeLinejoin="round" />) :
          value.rects.map((rect, index) => <rect key={index} x={rect.left} y={value.kind === "underline" ? rect.top + rect.height - 0.25 : rect.top}
            width={rect.width} height={value.kind === "underline" ? 0.3 : rect.height} fill={colors[value.color ?? "yellow"]} opacity={value.kind === "underline" ? 0.9 : 0.3} />)}
      </g>)}
      {preview.length ? <path d={path(preview)} fill="none" stroke="#075ea8" strokeWidth={0.35} strokeLinecap="round" /> : null}
    </svg>
    {mode === "select" ? controls.annotations.filter((value) => value.page === page && (value.kind === "note" || value.kind === "text")).map((value) => {
      const rect = value.rects[0]; if (!rect) return null;
      return <button key={value.id} className={`annotation-note ${value.kind}`} aria-label={`编辑批注 ${value.text}`} style={{ left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, minHeight: `${rect.height}%` }} onClick={() => onEdit(value)}>{value.text}</button>;
    }) : null}
  </div>;
}
