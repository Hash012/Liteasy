import type { JSX } from "react";
import { useState } from "react";
import type { FunctionPlotSpecV1, VisualizationArtifactV1 } from "../visualizationArtifact.types";
import type { FunctionPlotSampleResultV1 } from "../kernels/functionPlotKernel";
import { sampleFunctionPlot } from "../kernels/functionPlotKernel";

export type FunctionPlotRenderResult = FunctionPlotSampleResultV1 & {
  selectableObjectIds: readonly string[];
  svg: string;
};

const width = 640;
const height = 360;
const margin = { bottom: 44, left: 56, right: 24, top: 24 };

export function renderFunctionPlot(spec: FunctionPlotSpecV1): FunctionPlotRenderResult {
  const sampled = sampleFunctionPlot(spec);
  const allY = [
    ...sampled.points.map((point) => point.y),
    ...spec.keyPoints.map((point) => point.y)
  ].filter(Number.isFinite);
  const yMin = Math.min(...allY, -1);
  const yMax = Math.max(...allY, 1);
  const yPadding = Math.max((yMax - yMin) * 0.08, 0.5);
  const scale = makeScale(spec.domain.min, spec.domain.max, yMin - yPadding, yMax + yPadding);
  const pathSegments = sampled.segments
    .filter((segment) => segment.points.length > 1)
    .map((segment, index) => `<path id="plot-segment-${index}" d="${toPath(segment.points.map((point) => scale(point.x, point.y)))}" fill="none" stroke="#2563EB" stroke-width="2"/>`);
  const keyPoints = spec.keyPoints.map((point) => {
    const scaled = scale(point.x, point.y);
    return `<g id="object-${escapeText(point.id)}" tabindex="0"><circle cx="${num(scaled.x)}" cy="${num(scaled.y)}" r="5" fill="#DC2626"/><text x="${num(scaled.x + 8)}" y="${num(scaled.y - 8)}" fill="#111827">${escapeText(point.label ?? point.id)}</text></g>`;
  });
  const xAxis = scale(0, 0).y >= margin.top && scale(0, 0).y <= height - margin.bottom
    ? scale(0, 0).y
    : height - margin.bottom;
  const yAxis = scale(0, 0).x >= margin.left && scale(0, 0).x <= width - margin.right
    ? scale(0, 0).x
    : margin.left;
  const label = `${spec.axes.yLabel} over ${spec.axes.xLabel}`;

  return {
    ...sampled,
    selectableObjectIds: sampled.interaction.selectableObjectIds,
    svg: [
      `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="max-width:100%;height:auto;display:block" role="img" aria-label="${escapeText(label)}" xmlns="http://www.w3.org/2000/svg">`,
      `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>`,
      `<line x1="${margin.left}" y1="${num(xAxis)}" x2="${width - margin.right}" y2="${num(xAxis)}" stroke="#475569" stroke-width="1"/>`,
      `<line x1="${num(yAxis)}" y1="${margin.top}" x2="${num(yAxis)}" y2="${height - margin.bottom}" stroke="#475569" stroke-width="1"/>`,
      `<text x="${width / 2}" y="${height - 12}" text-anchor="middle" fill="#111827">${escapeText(spec.axes.xLabel)}</text>`,
      `<text x="18" y="${height / 2}" transform="rotate(-90 18 ${height / 2})" text-anchor="middle" fill="#111827">${escapeText(spec.axes.yLabel)}</text>`,
      ...pathSegments,
      ...keyPoints,
      `</svg>`
    ].join("")
  };
}

export function FunctionPlotRenderer({ rendered }: { rendered: FunctionPlotRenderResult }): JSX.Element {
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  return (
    <section aria-label={rendered.accessibility.summary} className="visualization-function-plot">
      <div
        className="visualization-function-plot__svg"
        dangerouslySetInnerHTML={{ __html: rendered.svg }}
      />
      <div aria-label="函数图对象">
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

export const functionPlotVisualizationRenderer = {
  id: "function-plot-svg",
  modality: "function_plot",
  render(artifact: VisualizationArtifactV1) {
    if (artifact.spec.modality !== "function_plot") throw new Error("function_plot_artifact_invalid");
    return <FunctionPlotRenderer rendered={renderFunctionPlot(artifact.spec.payload)} />;
  },
  version: "1.0.0"
} as const;

function makeScale(xMin: number, xMax: number, yMin: number, yMax: number) {
  return (x: number, y: number) => ({
    x: margin.left + ((x - xMin) / (xMax - xMin)) * (width - margin.left - margin.right),
    y: height - margin.bottom - ((y - yMin) / (yMax - yMin)) * (height - margin.top - margin.bottom)
  });
}

function toPath(points: readonly { x: number; y: number }[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${num(point.x)} ${num(point.y)}`).join(" ");
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
