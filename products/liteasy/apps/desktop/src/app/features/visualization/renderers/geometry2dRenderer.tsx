import { Button, Tooltip } from "@fluentui/react-components";
import { ArrowResetRegular, ZoomInRegular, ZoomOutRegular } from "@fluentui/react-icons";
import type { JSX } from "react";
import { useMemo, useState } from "react";
import type { Geometry2DSpecV1, VisualizationArtifactV1 } from "../visualizationArtifact.types";
import type { Geometry2DSolveResultV1 } from "../kernels/geometry2dKernel";
import { solveGeometry2D } from "../kernels/geometry2dKernel";
import type { CartesianViewport } from "./useCartesianViewport";
import { useCartesianViewport } from "./useCartesianViewport";
import "./interactiveMathRenderer.css";

export type Geometry2DRenderResult = Geometry2DSolveResultV1 & {
  selectableObjectIds: readonly string[];
  spec: Geometry2DSpecV1;
  svg: string;
  viewport: CartesianViewport;
};

type GeometryObject = Geometry2DSpecV1["objects"][number];

const width = 520;
const height = 520;
const margin = 32;

export function renderGeometry2D(
  spec: Geometry2DSpecV1,
  requestedViewport: CartesianViewport = spec.viewport,
  selectedObjectId: string | null = null
): Geometry2DRenderResult {
  const solved = solveGeometry2D(spec);
  const scale = makeScale(requestedViewport);
  const grid = renderGrid(requestedViewport, scale);
  const objects = spec.objects.map((object) => renderObject(
    object,
    requestedViewport,
    scale,
    selectedObjectId === object.id
  ));
  const derived = solved.derivedPoints.map((point) => {
    const scaled = scale(point.x, point.y);
    const selected = selectedObjectId === point.id;
    return `<g id="object-${escapeText(point.id)}" tabindex="0"><circle cx="${num(scaled.x)}" cy="${num(scaled.y)}" r="${selected ? 7 : 5}" fill="#DC2626"${selected ? ' stroke="#7F1D1D" stroke-width="3"' : ""}/><text x="${num(scaled.x + 8)}" y="${num(scaled.y + 18)}" fill="#111827" stroke="#FFFFFF" stroke-width="3" paint-order="stroke">${escapeText(point.id)}</text></g>`;
  });
  const selectableObjectIds = solved.interaction.selectableObjectIds;
  return {
    ...solved,
    selectableObjectIds,
    spec,
    svg: [
      `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="max-width:100%;height:auto;display:block" role="img" aria-label="${escapeText(selectableObjectIds.join(", "))}" xmlns="http://www.w3.org/2000/svg">`,
      `<defs><clipPath id="geometry-2d-clip"><rect x="${margin}" y="${margin}" width="${width - margin * 2}" height="${height - margin * 2}"/></clipPath></defs>`,
      `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>`,
      `<g clip-path="url(#geometry-2d-clip)">`,
      ...grid,
      ...objects,
      ...derived,
      `</g>`,
      `</svg>`
    ].join(""),
    viewport: requestedViewport
  };
}

export function Geometry2DRenderer({ rendered }: { rendered: Geometry2DRenderResult }): JSX.Element {
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const viewport = useCartesianViewport(rendered.viewport);
  const activeRender = useMemo(
    () => renderGeometry2D(rendered.spec, viewport.viewport, selectedObjectId),
    [rendered.spec, selectedObjectId, viewport.viewport]
  );

  return (
    <section aria-label={activeRender.accessibility.summary} className="visualization-geometry-2d visualization-interactive-math">
      <div aria-label="二维几何视图控制" className="visualization-interactive-math__toolbar">
        <Tooltip content="放大" relationship="label">
          <Button appearance="subtle" aria-label="放大二维几何" icon={<ZoomInRegular />} onClick={viewport.zoomIn} size="small" />
        </Tooltip>
        <Tooltip content="缩小" relationship="label">
          <Button appearance="subtle" aria-label="缩小二维几何" icon={<ZoomOutRegular />} onClick={viewport.zoomOut} size="small" />
        </Tooltip>
        <Tooltip content="重置视图" relationship="label">
          <Button appearance="subtle" aria-label="重置二维几何视图" icon={<ArrowResetRegular />} onClick={viewport.reset} size="small" />
        </Tooltip>
      </div>
      <div
        aria-label="二维几何画布"
        className="visualization-interactive-math__stage visualization-geometry-2d__stage"
        data-testid="geometry-2d-stage"
        data-viewport={viewport.viewportKey}
        onKeyDown={viewport.onKeyDown}
        onPointerCancel={viewport.onPointerCancel}
        onPointerDown={viewport.onPointerDown}
        onPointerMove={viewport.onPointerMove}
        onPointerUp={viewport.onPointerUp}
        onWheel={viewport.onWheel}
        tabIndex={0}
      >
        <div
          className="visualization-geometry-2d__svg"
          data-testid="geometry-2d-svg"
          dangerouslySetInnerHTML={{ __html: activeRender.svg }}
        />
      </div>
      <div aria-label="几何对象" className="visualization-interactive-math__objects">
        {activeRender.selectableObjectIds.map((id) => (
          <Button
            appearance={selectedObjectId === id ? "primary" : "subtle"}
            aria-pressed={selectedObjectId === id}
            data-object-id={id}
            key={id}
            onClick={() => setSelectedObjectId((current) => current === id ? null : id)}
            size="small"
          >
            {id}
          </Button>
        ))}
      </div>
      <table className="visualization-interactive-math__table">
        <tbody>
          {activeRender.accessibility.dataTable?.map((row) => (
            <tr key={`${row.label}:${row.value}`}>
              <th scope="row">{row.label}</th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export const geometry2dVisualizationRenderer = {
  id: "geometry-2d-svg",
  modality: "geometry_2d",
  render(artifact: VisualizationArtifactV1) {
    if (artifact.spec.modality !== "geometry_2d") throw new Error("geometry_2d_artifact_invalid");
    return <Geometry2DRenderer rendered={renderGeometry2D(artifact.spec.payload)} />;
  },
  version: "1.0.0"
} as const;

function renderGrid(
  viewport: CartesianViewport,
  scale: (x: number, y: number) => { x: number; y: number }
): string[] {
  const xStep = niceStep((viewport.xMax - viewport.xMin) / 8);
  const yStep = niceStep((viewport.yMax - viewport.yMin) / 8);
  const lines: string[] = [];
  for (let x = Math.ceil(viewport.xMin / xStep) * xStep; x <= viewport.xMax + xStep * 0.01; x += xStep) {
    const scaled = scale(x, 0).x;
    lines.push(`<line x1="${num(scaled)}" y1="${margin}" x2="${num(scaled)}" y2="${height - margin}" stroke="${Math.abs(x) < xStep * 0.01 ? "#64748B" : "#E2E8F0"}" stroke-width="1"/>`);
  }
  for (let y = Math.ceil(viewport.yMin / yStep) * yStep; y <= viewport.yMax + yStep * 0.01; y += yStep) {
    const scaled = scale(0, y).y;
    lines.push(`<line x1="${margin}" y1="${num(scaled)}" x2="${width - margin}" y2="${num(scaled)}" stroke="${Math.abs(y) < yStep * 0.01 ? "#64748B" : "#E2E8F0"}" stroke-width="1"/>`);
  }
  return lines;
}

function renderObject(
  object: GeometryObject,
  viewport: CartesianViewport,
  scale: (x: number, y: number) => { x: number; y: number },
  selected: boolean
): string {
  const strokeWidth = selected ? 4 : 2;
  const selectedStroke = selected ? "#0F172A" : null;
  if (object.kind === "circle") {
    const center = scale(numberData(object, "cx"), numberData(object, "cy"));
    const edge = scale(numberData(object, "cx") + numberData(object, "radius"), numberData(object, "cy"));
    return `<g id="object-${escapeText(object.id)}" tabindex="0"><circle cx="${num(center.x)}" cy="${num(center.y)}" r="${num(Math.abs(edge.x - center.x))}" fill="none" stroke="${selectedStroke ?? "#2563EB"}" stroke-width="${strokeWidth}"/><text x="${num(center.x + 8)}" y="${num(center.y - 8)}" fill="#111827">${escapeText(object.id)}</text></g>`;
  }
  if (object.kind === "line" || object.kind === "segment") {
    const endpoints = object.kind === "line" ? clippedLineEndpoints(object, viewport) : rawLineEndpoints(object);
    const start = scale(endpoints[0].x, endpoints[0].y);
    const end = scale(endpoints[1].x, endpoints[1].y);
    return `<g id="object-${escapeText(object.id)}" tabindex="0"><path d="M ${num(start.x)} ${num(start.y)} L ${num(end.x)} ${num(end.y)}" fill="none" stroke="${selectedStroke ?? "#0F766E"}" stroke-width="${strokeWidth}"/><text x="${num((start.x + end.x) / 2 + 8)}" y="${num((start.y + end.y) / 2 - 12)}" fill="#111827" stroke="#FFFFFF" stroke-width="3" paint-order="stroke">${escapeText(object.id)}</text></g>`;
  }
  if (object.kind === "point") {
    const point = scale(numberData(object, "x"), numberData(object, "y"));
    return `<g id="object-${escapeText(object.id)}" tabindex="0"><circle cx="${num(point.x)}" cy="${num(point.y)}" r="${selected ? 7 : 4}" fill="#7C3AED"${selected ? ' stroke="#0F172A" stroke-width="3"' : ""}/><text x="${num(point.x + 8)}" y="${num(point.y - 8)}" fill="#111827">${escapeText(object.id)}</text></g>`;
  }
  if (object.kind === "arc") {
    const cx = numberData(object, "cx");
    const cy = numberData(object, "cy");
    const radius = numberData(object, "radius");
    const startAngle = numberData(object, "startAngle");
    const endAngle = numberData(object, "endAngle");
    const start = scale(cx + radius * Math.cos(toRadians(startAngle)), cy + radius * Math.sin(toRadians(startAngle)));
    const end = scale(cx + radius * Math.cos(toRadians(endAngle)), cy + radius * Math.sin(toRadians(endAngle)));
    const center = scale(cx, cy);
    const edge = scale(cx + radius, cy);
    const radiusPixels = Math.abs(edge.x - center.x);
    const sweep = endAngle - startAngle;
    const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
    const sweepFlag = sweep >= 0 ? 0 : 1;
    return `<g id="object-${escapeText(object.id)}" tabindex="0"><path d="M ${num(start.x)} ${num(start.y)} A ${num(radiusPixels)} ${num(radiusPixels)} 0 ${largeArc} ${sweepFlag} ${num(end.x)} ${num(end.y)}" fill="none" stroke="${selectedStroke ?? "#B45309"}" stroke-width="${strokeWidth}"/><text x="${num(end.x + 8)}" y="${num(end.y - 8)}" fill="#111827">${escapeText(object.id)}</text></g>`;
  }
  const points = pointData(object).map((point) => scale(point.x, point.y));
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${num(point.x)} ${num(point.y)}`).join(" ");
  const close = object.kind === "polygon" ? " Z" : "";
  const stroke = selectedStroke ?? (object.kind === "polygon" ? "#2563EB" : "#BE185D");
  const first = points[0];
  return `<g id="object-${escapeText(object.id)}" tabindex="0"><path d="${path}${close}" fill="${object.kind === "polygon" ? "#DBEAFE" : "none"}" fill-opacity="0.35" stroke="${stroke}" stroke-width="${strokeWidth}"/><text x="${num(first.x + 8)}" y="${num(first.y - 8)}" fill="#111827">${escapeText(object.id)}</text></g>`;
}

function clippedLineEndpoints(object: GeometryObject, viewport: CartesianViewport): [{ x: number; y: number }, { x: number; y: number }] {
  const start = { x: numberData(object, "x1"), y: numberData(object, "y1") };
  const end = { x: numberData(object, "x2"), y: numberData(object, "y2") };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const candidates: Array<{ x: number; y: number }> = [];
  if (Math.abs(dx) > 1e-9) {
    for (const x of [viewport.xMin, viewport.xMax]) {
      const y = start.y + ((x - start.x) / dx) * dy;
      if (y >= viewport.yMin - 1e-9 && y <= viewport.yMax + 1e-9) candidates.push({ x, y });
    }
  }
  if (Math.abs(dy) > 1e-9) {
    for (const y of [viewport.yMin, viewport.yMax]) {
      const x = start.x + ((y - start.y) / dy) * dx;
      if (x >= viewport.xMin - 1e-9 && x <= viewport.xMax + 1e-9) candidates.push({ x, y });
    }
  }
  const unique = candidates.filter((candidate, index) => candidates.findIndex((other) => (
    Math.hypot(candidate.x - other.x, candidate.y - other.y) < 1e-9
  )) === index);
  return unique.length >= 2 ? [unique[0], unique[unique.length - 1]] : [start, end];
}

function rawLineEndpoints(object: GeometryObject): [{ x: number; y: number }, { x: number; y: number }] {
  return [
    { x: numberData(object, "x1"), y: numberData(object, "y1") },
    { x: numberData(object, "x2"), y: numberData(object, "y2") }
  ];
}

function makeScale(viewport: CartesianViewport) {
  return (x: number, y: number) => ({
    x: margin + ((x - viewport.xMin) / (viewport.xMax - viewport.xMin)) * (width - margin * 2),
    y: height - margin - ((y - viewport.yMin) / (viewport.yMax - viewport.yMin)) * (height - margin * 2)
  });
}

function pointData(object: GeometryObject): Array<{ x: number; y: number }> {
  const value = object.data.points;
  if (!Array.isArray(value)) return [];
  return Array.from({ length: value.length / 2 }, (_, index) => ({
    x: value[index * 2],
    y: value[index * 2 + 1]
  }));
}

function numberData(object: GeometryObject, key: string): number {
  const value = object.data[key];
  return typeof value === "number" ? value : 0;
}

function niceStep(rawStep: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(rawStep, 1e-12)));
  const normalized = rawStep / power;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * power;
}

function toRadians(value: number): number {
  return value * Math.PI / 180;
}

function num(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function escapeText(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}
