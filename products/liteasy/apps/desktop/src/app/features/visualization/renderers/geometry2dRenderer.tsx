import type { JSX } from "react";
import { useState } from "react";
import type { Geometry2DSpecV1, VisualizationArtifactV1 } from "../visualizationArtifact.types";
import type { Geometry2DSolveResultV1 } from "../kernels/geometry2dKernel";
import { solveGeometry2D } from "../kernels/geometry2dKernel";

export type Geometry2DRenderResult = Geometry2DSolveResultV1 & {
  selectableObjectIds: readonly string[];
  svg: string;
};

const width = 520;
const height = 520;
const margin = 32;

export function renderGeometry2D(spec: Geometry2DSpecV1): Geometry2DRenderResult {
  const solved = solveGeometry2D(spec);
  const scale = makeScale(spec);
  const objects = spec.objects.map((object) => renderObject(object, scale));
  const derived = solved.derivedPoints.map((point) => {
    const scaled = scale(point.x, point.y);
    return `<g id="object-${escapeText(point.id)}" tabindex="0"><circle cx="${num(scaled.x)}" cy="${num(scaled.y)}" r="5" fill="#DC2626"/><text x="${num(scaled.x + 8)}" y="${num(scaled.y - 8)}" fill="#111827">${escapeText(point.id)}</text></g>`;
  });
  const selectableObjectIds = solved.interaction.selectableObjectIds;
  return {
    ...solved,
    selectableObjectIds,
    svg: [
      `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="max-width:100%;height:auto;display:block" role="img" aria-label="${escapeText(selectableObjectIds.join(", "))}" xmlns="http://www.w3.org/2000/svg">`,
      `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>`,
      `<path d="M ${margin} ${height / 2} L ${width - margin} ${height / 2} M ${width / 2} ${margin} L ${width / 2} ${height - margin}" stroke="#CBD5E1" stroke-width="1" fill="none"/>`,
      ...objects,
      ...derived,
      `</svg>`
    ].join("")
  };
}

export function Geometry2DRenderer({ rendered }: { rendered: Geometry2DRenderResult }): JSX.Element {
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  return (
    <section aria-label={rendered.accessibility.summary} className="visualization-geometry-2d">
      <div
        className="visualization-geometry-2d__svg"
        dangerouslySetInnerHTML={{ __html: rendered.svg }}
      />
      <div aria-label="几何对象">
        {rendered.selectableObjectIds.map((id) => (
          <button
            aria-pressed={selectedObjectId === id}
            data-object-id={id}
            key={id}
            onClick={() => setSelectedObjectId(id)}
            type="button"
          >
            {id}
          </button>
        ))}
      </div>
      <table>
        <tbody>
          {rendered.accessibility.dataTable?.map((row) => (
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

function renderObject(object: Geometry2DSpecV1["objects"][number], scale: (x: number, y: number) => { x: number; y: number }): string {
  if (object.kind === "circle") {
    const center = scale(numberData(object, "cx"), numberData(object, "cy"));
    const edge = scale(numberData(object, "cx") + numberData(object, "radius"), numberData(object, "cy"));
    return `<g id="object-${escapeText(object.id)}" tabindex="0"><circle cx="${num(center.x)}" cy="${num(center.y)}" r="${num(Math.abs(edge.x - center.x))}" fill="none" stroke="#2563EB" stroke-width="2"/><text x="${num(center.x + 8)}" y="${num(center.y - 8)}" fill="#111827">${escapeText(object.id)}</text></g>`;
  }
  if (object.kind === "line" || object.kind === "segment") {
    const start = scale(numberData(object, "x1"), numberData(object, "y1"));
    const end = scale(numberData(object, "x2"), numberData(object, "y2"));
    return `<g id="object-${escapeText(object.id)}" tabindex="0"><path d="M ${num(start.x)} ${num(start.y)} L ${num(end.x)} ${num(end.y)}" fill="none" stroke="#0F766E" stroke-width="2"/><text x="${num((start.x + end.x) / 2 + 8)}" y="${num((start.y + end.y) / 2 - 8)}" fill="#111827">${escapeText(object.id)}</text></g>`;
  }
  if (object.kind === "point") {
    const point = scale(numberData(object, "x"), numberData(object, "y"));
    return `<g id="object-${escapeText(object.id)}" tabindex="0"><circle cx="${num(point.x)}" cy="${num(point.y)}" r="4" fill="#7C3AED"/><text x="${num(point.x + 8)}" y="${num(point.y - 8)}" fill="#111827">${escapeText(object.id)}</text></g>`;
  }
  return `<g id="object-${escapeText(object.id)}" tabindex="0"></g>`;
}

function makeScale(spec: Geometry2DSpecV1) {
  return (x: number, y: number) => ({
    x: margin + ((x - spec.viewport.xMin) / (spec.viewport.xMax - spec.viewport.xMin)) * (width - margin * 2),
    y: height - margin - ((y - spec.viewport.yMin) / (spec.viewport.yMax - spec.viewport.yMin)) * (height - margin * 2)
  });
}

function numberData(object: Geometry2DSpecV1["objects"][number], key: string): number {
  const value = object.data[key];
  return typeof value === "number" ? value : 0;
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
