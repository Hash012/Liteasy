import type { JSX } from "react";
import { useState } from "react";
import type { Geometry3DSpecV1, VisualizationArtifactV1 } from "../visualizationArtifact.types";
import type { Geometry3DSolveResultV1 } from "../kernels/geometry3dKernel";
import { solveGeometry3D } from "../kernels/geometry3dKernel";

export type Geometry3DRenderResult = Geometry3DSolveResultV1 & {
  selectableObjectIds: readonly string[];
  svg: string;
};

const width = 560;
const height = 420;
const margin = 36;

export function renderGeometry3D(spec: Geometry3DSpecV1): Geometry3DRenderResult {
  const solved = solveGeometry3D(spec);
  const projected = solved.fallbackProjection;
  const bounds = projectionBounds(projected);
  const scale = (x: number, y: number) => ({
    x: margin + ((x - bounds.xMin) / (bounds.xMax - bounds.xMin || 1)) * (width - margin * 2),
    y: height - margin - ((y - bounds.yMin) / (bounds.yMax - bounds.yMin || 1)) * (height - margin * 2)
  });
  const sections = solved.sections.map((section) => {
    const path = section.vertices
      .map((vertex, index) => {
        const projectedVertex = scale(vertex[0] - vertex[1] * 0.35, vertex[2] + vertex[1] * 0.35);
        return `${index === 0 ? "M" : "L"} ${num(projectedVertex.x)} ${num(projectedVertex.y)}`;
      })
      .join(" ");
    return `<g id="object-${escapeText(section.id)}" tabindex="0"><path d="${path} Z" fill="rgba(220,38,38,0.16)" stroke="#DC2626" stroke-width="2"/><text x="${margin}" y="${height - 14}" fill="#111827">${escapeText(section.id)}</text></g>`;
  });
  const objectGroups = spec.objects.map((object) => {
    const vertices = object.vertices.map((vertex) => {
      const projectedVertex = scale(vertex[0] - vertex[1] * 0.35, vertex[2] + vertex[1] * 0.35);
      return `<circle cx="${num(projectedVertex.x)}" cy="${num(projectedVertex.y)}" r="3" fill="#2563EB"/>`;
    });
    return `<g id="object-${escapeText(object.id)}" tabindex="0"><title>${escapeText(object.id)}</title>${vertices.join("")}</g>`;
  });
  const selectableObjectIds = solved.interaction.selectableObjectIds;

  return {
    ...solved,
    selectableObjectIds,
    svg: [
      `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="max-width:100%;height:auto;display:block" role="img" aria-label="${escapeText(selectableObjectIds.join(", "))}" xmlns="http://www.w3.org/2000/svg">`,
      `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>`,
      `<path d="M ${margin} ${height - margin} L ${width - margin} ${height - margin} L ${width - margin - 48} ${height - margin - 48}" fill="none" stroke="#CBD5E1" stroke-width="1"/>`,
      ...objectGroups,
      ...sections,
      `</svg>`
    ].join("")
  };
}

export function Geometry3DRenderer({ rendered }: { rendered: Geometry3DRenderResult }): JSX.Element {
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  return (
    <section aria-label={rendered.accessibility.summary} className="visualization-geometry-3d">
      <div
        className="visualization-geometry-3d__svg"
        dangerouslySetInnerHTML={{ __html: rendered.svg }}
      />
      <div aria-label="三维对象">
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

export const geometry3dVisualizationRenderer = {
  id: "geometry-3d-svg",
  modality: "geometry_3d",
  render(artifact: VisualizationArtifactV1) {
    if (artifact.spec.modality !== "geometry_3d") throw new Error("geometry_3d_artifact_invalid");
    return <Geometry3DRenderer rendered={renderGeometry3D(artifact.spec.payload)} />;
  },
  version: "1.0.0"
} as const;

function projectionBounds(points: readonly { x: number; y: number }[]) {
  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  return {
    xMax: Math.max(...xValues, 1),
    xMin: Math.min(...xValues, 0),
    yMax: Math.max(...yValues, 1),
    yMin: Math.min(...yValues, 0)
  };
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
