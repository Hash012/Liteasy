import { Button, Slider, Tooltip } from "@fluentui/react-components";
import { ArrowResetRegular, ZoomInRegular, ZoomOutRegular } from "@fluentui/react-icons";
import type { JSX } from "react";
import { useMemo, useState } from "react";
import type { FunctionPlotSpecV1, VisualizationArtifactV1 } from "../visualizationArtifact.types";
import type { FunctionPlotSampleResultV1 } from "../kernels/functionPlotKernel";
import { sampleFunctionPlot } from "../kernels/functionPlotKernel";
import type { CartesianViewport } from "./useCartesianViewport";
import { useCartesianViewport } from "./useCartesianViewport";
import "./interactiveMathRenderer.css";

export type FunctionPlotRenderResult = FunctionPlotSampleResultV1 & {
  selectableObjectIds: readonly string[];
  spec: FunctionPlotSpecV1;
  svg: string;
  viewport: CartesianViewport;
};

const width = 640;
const height = 360;
const margin = { bottom: 44, left: 56, right: 24, top: 24 };
const auxiliaryColors = ["#0F766E", "#7C3AED", "#B45309", "#BE185D"];

export function renderFunctionPlot(
  spec: FunctionPlotSpecV1,
  requestedViewport?: CartesianViewport,
  selectedObjectId: string | null = null
): FunctionPlotRenderResult {
  const samplingDomain = requestedViewport
    ? { max: requestedViewport.xMax, min: requestedViewport.xMin }
    : spec.domain;
  const sampled = sampleFunctionPlot(spec, 201, samplingDomain);
  const viewport = requestedViewport ?? deriveInitialViewport(spec, sampled);
  const scale = makeScale(viewport.xMin, viewport.xMax, viewport.yMin, viewport.yMax);
  const primaryPaths = renderSegments("plot", sampled.segments, scale, "#2563EB", false);
  const auxiliaryPaths = sampled.auxiliaryCurves.flatMap((curve, curveIndex) => renderSegments(
    `plot-curve-${curve.id}`,
    curve.segments,
    scale,
    auxiliaryColors[curveIndex % auxiliaryColors.length],
    selectedObjectId === curve.id
  ));
  const keyPoints = spec.keyPoints.map((point) => {
    const scaled = scale(point.x, point.y);
    const selected = selectedObjectId === point.id;
    return `<g id="object-${escapeText(point.id)}" tabindex="0"><circle cx="${num(scaled.x)}" cy="${num(scaled.y)}" r="${selected ? 7 : 5}" fill="#DC2626"${selected ? ' stroke="#7F1D1D" stroke-width="3"' : ""}/><text x="${num(scaled.x + 8)}" y="${num(scaled.y - 8)}" fill="#111827">${escapeText(point.label ?? point.id)}</text></g>`;
  });
  const origin = scale(0, 0);
  const xAxis = origin.y >= margin.top && origin.y <= height - margin.bottom
    ? origin.y
    : height - margin.bottom;
  const yAxis = origin.x >= margin.left && origin.x <= width - margin.right
    ? origin.x
    : margin.left;
  const gridAndTicks = renderGridAndTicks(viewport, scale);
  const label = `${spec.axes.yLabel} over ${spec.axes.xLabel}`;

  return {
    ...sampled,
    selectableObjectIds: sampled.interaction.selectableObjectIds,
    spec,
    svg: [
      `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="max-width:100%;height:auto;display:block" role="img" aria-label="${escapeText(label)}" xmlns="http://www.w3.org/2000/svg">`,
      `<defs><clipPath id="function-plot-clip"><rect x="${margin.left}" y="${margin.top}" width="${width - margin.left - margin.right}" height="${height - margin.top - margin.bottom}"/></clipPath></defs>`,
      `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>`,
      ...gridAndTicks,
      `<line x1="${margin.left}" y1="${num(xAxis)}" x2="${width - margin.right}" y2="${num(xAxis)}" stroke="#475569" stroke-width="1"/>`,
      `<line x1="${num(yAxis)}" y1="${margin.top}" x2="${num(yAxis)}" y2="${height - margin.bottom}" stroke="#475569" stroke-width="1"/>`,
      `<text x="${width / 2}" y="${height - 12}" text-anchor="middle" fill="#111827">${escapeText(spec.axes.xLabel)}</text>`,
      `<text x="18" y="${height / 2}" transform="rotate(-90 18 ${height / 2})" text-anchor="middle" fill="#111827">${escapeText(spec.axes.yLabel)}</text>`,
      `<g clip-path="url(#function-plot-clip)">`,
      ...primaryPaths,
      ...auxiliaryPaths,
      ...keyPoints,
      `</g>`,
      `</svg>`
    ].join(""),
    viewport
  };
}

export function FunctionPlotRenderer({ rendered }: { rendered: FunctionPlotRenderResult }): JSX.Element {
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [parameterValues, setParameterValues] = useState<Record<string, number>>(() => Object.fromEntries(
    rendered.spec.parameters.map((parameter) => [parameter.id, parameter.value])
  ));
  const viewport = useCartesianViewport(rendered.viewport);
  const activeSpec = useMemo<FunctionPlotSpecV1>(() => ({
    ...rendered.spec,
    parameters: rendered.spec.parameters.map((parameter) => ({
      ...parameter,
      value: parameterValues[parameter.id] ?? parameter.value
    }))
  }), [parameterValues, rendered.spec]);
  const activeRender = useMemo(
    () => renderFunctionPlot(activeSpec, viewport.viewport, selectedObjectId),
    [activeSpec, selectedObjectId, viewport.viewport]
  );

  return (
    <section aria-label={activeRender.accessibility.summary} className="visualization-function-plot visualization-interactive-math">
      <div aria-label="函数图视图控制" className="visualization-interactive-math__toolbar">
        <Tooltip content="放大" relationship="label">
          <Button appearance="subtle" aria-label="放大函数图" icon={<ZoomInRegular />} onClick={viewport.zoomIn} size="small" />
        </Tooltip>
        <Tooltip content="缩小" relationship="label">
          <Button appearance="subtle" aria-label="缩小函数图" icon={<ZoomOutRegular />} onClick={viewport.zoomOut} size="small" />
        </Tooltip>
        <Tooltip content="重置视图" relationship="label">
          <Button appearance="subtle" aria-label="重置函数图视图" icon={<ArrowResetRegular />} onClick={viewport.reset} size="small" />
        </Tooltip>
      </div>
      <div
        aria-label="函数图画布"
        className="visualization-interactive-math__stage visualization-function-plot__stage"
        data-testid="function-plot-stage"
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
          className="visualization-function-plot__svg"
          data-testid="function-plot-svg"
          dangerouslySetInnerHTML={{ __html: activeRender.svg }}
        />
      </div>
      {activeSpec.parameters.length > 0 ? (
        <div aria-label="函数参数" className="visualization-interactive-math__parameters">
          {activeSpec.parameters.map((parameter) => (
            <label className="visualization-interactive-math__parameter" key={parameter.id}>
              <span>{parameter.id}</span>
              <Slider
                aria-label={`参数 ${parameter.id}`}
                disabled={parameter.min === parameter.max}
                max={parameter.max}
                min={parameter.min}
                onChange={(_, data) => setParameterValues((current) => ({ ...current, [parameter.id]: data.value }))}
                step={parameterStep(parameter.min, parameter.max)}
                value={parameter.value}
              />
              <output>{formatParameter(parameter.value, parameter.unit)}</output>
            </label>
          ))}
        </div>
      ) : null}
      <div aria-label="函数图对象" className="visualization-interactive-math__objects">
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

export const functionPlotVisualizationRenderer = {
  id: "function-plot-svg",
  modality: "function_plot",
  render(artifact: VisualizationArtifactV1) {
    if (artifact.spec.modality !== "function_plot") throw new Error("function_plot_artifact_invalid");
    return <FunctionPlotRenderer rendered={renderFunctionPlot(artifact.spec.payload)} />;
  },
  version: "1.0.0"
} as const;

function deriveInitialViewport(spec: FunctionPlotSpecV1, sampled: FunctionPlotSampleResultV1): CartesianViewport {
  const allY = [
    ...sampled.points.map((point) => point.y),
    ...sampled.auxiliaryCurves.flatMap((curve) => curve.segments.flatMap((segment) => segment.points.map((point) => point.y))),
    ...spec.keyPoints.map((point) => point.y)
  ].filter(Number.isFinite);
  const yMin = Math.min(...allY, -1);
  const yMax = Math.max(...allY, 1);
  const yPadding = Math.max((yMax - yMin) * 0.08, 0.5);
  return {
    xMax: spec.domain.max,
    xMin: spec.domain.min,
    yMax: yMax + yPadding,
    yMin: yMin - yPadding
  };
}

function renderSegments(
  idPrefix: string,
  segments: FunctionPlotSampleResultV1["segments"],
  scale: (x: number, y: number) => { x: number; y: number },
  stroke: string,
  selected: boolean
): string[] {
  return segments
    .filter((segment) => segment.points.length > 1)
    .map((segment, index) => `<path id="${escapeText(idPrefix)}-segment-${index}" d="${toPath(segment.points.map((point) => scale(point.x, point.y)))}" fill="none" stroke="${stroke}" stroke-width="${selected ? 4 : 2}"/>`);
}

function renderGridAndTicks(
  viewport: CartesianViewport,
  scale: (x: number, y: number) => { x: number; y: number }
): string[] {
  const elements: string[] = [];
  for (let index = 0; index <= 4; index += 1) {
    const x = viewport.xMin + (viewport.xMax - viewport.xMin) * (index / 4);
    const scaledX = scale(x, 0).x;
    elements.push(`<line x1="${num(scaledX)}" y1="${margin.top}" x2="${num(scaledX)}" y2="${height - margin.bottom}" stroke="#E2E8F0" stroke-width="1"/>`);
    elements.push(`<text x="${num(scaledX)}" y="${height - margin.bottom + 16}" text-anchor="middle" fill="#64748B" font-size="10">${formatTick(x)}</text>`);
  }
  for (let index = 0; index <= 4; index += 1) {
    const y = viewport.yMin + (viewport.yMax - viewport.yMin) * (index / 4);
    const scaledY = scale(0, y).y;
    elements.push(`<line x1="${margin.left}" y1="${num(scaledY)}" x2="${width - margin.right}" y2="${num(scaledY)}" stroke="#E2E8F0" stroke-width="1"/>`);
    elements.push(`<text x="${margin.left - 8}" y="${num(scaledY + 3)}" text-anchor="end" fill="#64748B" font-size="10">${formatTick(y)}</text>`);
  }
  return elements;
}

function makeScale(xMin: number, xMax: number, yMin: number, yMax: number) {
  return (x: number, y: number) => ({
    x: margin.left + ((x - xMin) / (xMax - xMin)) * (width - margin.left - margin.right),
    y: height - margin.bottom - ((y - yMin) / (yMax - yMin)) * (height - margin.top - margin.bottom)
  });
}

function toPath(points: readonly { x: number; y: number }[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${num(point.x)} ${num(point.y)}`).join(" ");
}

function parameterStep(min: number, max: number): number {
  if (min === max) return 1;
  return Number(Math.max((max - min) / 100, 1e-6).toPrecision(6));
}

function formatParameter(value: number, unit?: string): string {
  const formatted = Number(value.toFixed(6)).toString();
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatTick(value: number): string {
  if (Math.abs(value) < 1e-10) return "0";
  if (Math.abs(value) >= 10000 || Math.abs(value) < 0.001) return value.toExponential(1);
  return Number(value.toPrecision(4)).toString();
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
