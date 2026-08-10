import type { JSX } from "react";
import { useState } from "react";
import type { PhysicsProcessSpecV1, VisualizationArtifactV1 } from "../visualizationArtifact.types";
import type { PhysicsProcessResultV1 } from "../kernels/physicsProcessKernel";
import { simulatePhysicsProcess } from "../kernels/physicsProcessKernel";

export type PhysicsProcessRenderResult = PhysicsProcessResultV1 & {
  selectableObjectIds: readonly string[];
  svg: string;
};

const width = 640;
const height = 360;
const margin = 32;

export function renderPhysicsProcess(spec: PhysicsProcessSpecV1): PhysicsProcessRenderResult {
  const simulated = simulatePhysicsProcess(spec, spec.seed);
  const xValues = simulated.frames.map((frame) => frame.state.x ?? 0);
  const yValues = simulated.frames.map((frame) => frame.state.y ?? 0);
  const bounds = {
    xMax: Math.max(...xValues, 1),
    xMin: Math.min(...xValues, 0),
    yMax: Math.max(...yValues, 1),
    yMin: Math.min(...yValues, 0)
  };
  const scale = (x: number, y: number) => ({
    x: margin + ((x - bounds.xMin) / (bounds.xMax - bounds.xMin || 1)) * (width - margin * 2),
    y: height - margin - ((y - bounds.yMin) / (bounds.yMax - bounds.yMin || 1)) * (height - margin * 2)
  });
  const path = simulated.frames.map((frame, index) => {
    const point = scale(frame.state.x ?? 0, frame.state.y ?? 0);
    return `${index === 0 ? "M" : "L"} ${num(point.x)} ${num(point.y)}`;
  }).join(" ");
  return {
    ...simulated,
    selectableObjectIds: simulated.interaction.selectableObjectIds,
    svg: [
      `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="max-width:100%;height:auto;display:block" role="img" aria-label="${escapeText(simulated.accessibility.summary)}" xmlns="http://www.w3.org/2000/svg">`,
      `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>`,
      `<path d="M ${margin} ${height - margin} L ${width - margin} ${height - margin}" stroke="#CBD5E1" stroke-width="1"/>`,
      `<g id="object-trajectory" tabindex="0"><path d="${path}" fill="none" stroke="#2563EB" stroke-width="2"/><circle cx="${margin}" cy="${height - margin}" r="4" fill="#DC2626"/></g>`,
      `</svg>`
    ].join("")
  };
}

export function PhysicsProcessRenderer({ rendered }: { rendered: PhysicsProcessRenderResult }): JSX.Element {
  const [frameIndex, setFrameIndex] = useState(0);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const lastFrame = Math.max(0, rendered.frames.length - 1);
  return (
    <section aria-label={rendered.accessibility.summary} className="visualization-physics-process">
      <div dangerouslySetInnerHTML={{ __html: rendered.svg }} />
      <div aria-label="过程控制">
        <button onClick={() => setFrameIndex(Math.max(0, frameIndex - 1))} type="button">上一帧</button>
        <output data-testid="physics-process-frame">{frameIndex} / {lastFrame}</output>
        <button onClick={() => setFrameIndex(Math.min(lastFrame, frameIndex + 1))} type="button">下一帧</button>
      </div>
      <div aria-label="物理过程对象">
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

export const physicsProcessVisualizationRenderer = {
  id: "physics-process-svg",
  modality: "physics_process",
  render(artifact: VisualizationArtifactV1) {
    if (artifact.spec.modality !== "physics_process") throw new Error("physics_process_artifact_invalid");
    return <PhysicsProcessRenderer rendered={renderPhysicsProcess(artifact.spec.payload)} />;
  },
  version: "1.0.0"
} as const;

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
