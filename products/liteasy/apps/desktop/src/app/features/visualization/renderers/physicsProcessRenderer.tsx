import { Button, Slider, Tooltip } from "@fluentui/react-components";
import { NextRegular, PauseRegular, PlayRegular, PreviousRegular } from "@fluentui/react-icons";
import type { JSX } from "react";
import { useEffect, useMemo, useState } from "react";
import type { PhysicsProcessSpecV1, VisualizationArtifactV1 } from "../visualizationArtifact.types";
import type { PhysicsProcessResultV1 } from "../kernels/physicsProcessKernel";
import { simulatePhysicsProcess } from "../kernels/physicsProcessKernel";
import { runPhysicsProcessWorker } from "../workers/physicsProcess.worker";
import "./processRenderer.css";

export type PhysicsProcessRenderResult = PhysicsProcessResultV1 & {
  selectableObjectIds: readonly string[];
  spec: PhysicsProcessSpecV1;
  svg: string;
};

const width = 640;
const height = 360;
const margin = 40;

export function renderPhysicsProcess(spec: PhysicsProcessSpecV1): PhysicsProcessRenderResult {
  const simulated = simulatePhysicsProcess(spec, spec.seed);
  return projectPhysicsProcess(spec, simulated, 0, null);
}

export function projectPhysicsProcess(
  spec: PhysicsProcessSpecV1,
  simulated: PhysicsProcessResultV1,
  requestedFrameIndex: number,
  selectedObjectId: string | null
): PhysicsProcessRenderResult {
  const frameIndex = clampFrameIndex(requestedFrameIndex, simulated.frames.length);
  const currentFrame = simulated.frames[frameIndex];
  const bounds = trajectoryBounds(simulated.frames);
  const scale = (x: number, y: number) => ({
    x: margin + ((x - bounds.xMin) / (bounds.xMax - bounds.xMin || 1)) * (width - margin * 2),
    y: height - margin - ((y - bounds.yMin) / (bounds.yMax - bounds.yMin || 1)) * (height - margin * 2)
  });
  const visibleFrames = simulated.frames.slice(0, frameIndex + 1);
  const path = visibleFrames.map((frame, index) => {
    const point = scale(frame.state.x ?? 0, frame.state.y ?? 0);
    return `${index === 0 ? "M" : "L"} ${num(point.x)} ${num(point.y)}`;
  }).join(" ");
  const currentPoint = scale(currentFrame?.state.x ?? 0, currentFrame?.state.y ?? 0);
  const trajectorySelected = selectedObjectId === "trajectory";
  const eventMarkers = spec.events.map((event) => {
    const nearestFrame = simulated.frames.reduce((nearest, frame) => (
      Math.abs(frame.time - event.time) < Math.abs(nearest.time - event.time) ? frame : nearest
    ), simulated.frames[0]);
    const point = scale(nearestFrame.state.x ?? 0, nearestFrame.state.y ?? 0);
    const selected = selectedObjectId === event.id;
    const reached = event.time <= (currentFrame?.time ?? 0);
    return `<g id="object-${escapeText(event.id)}" opacity="${reached ? 1 : 0.35}" tabindex="0"><circle cx="${num(point.x)}" cy="${num(point.y)}" r="${selected ? 7 : 5}" fill="#B45309"${selected ? ' stroke="#78350F" stroke-width="3"' : ""}/><text x="${num(point.x + 8)}" y="${num(point.y - 8)}" fill="#713F12" font-size="11">${escapeText(event.label)}</text></g>`;
  });
  const grid = renderGrid();

  return {
    ...simulated,
    selectableObjectIds: simulated.interaction.selectableObjectIds,
    spec,
    svg: [
      `<svg data-frame-index="${frameIndex}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="max-width:100%;height:auto;display:block" role="img" aria-label="${escapeText(simulated.accessibility.summary)}" xmlns="http://www.w3.org/2000/svg">`,
      `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>`,
      ...grid,
      `<path d="M ${margin} ${height - margin} L ${width - margin} ${height - margin}" stroke="#64748B" stroke-width="1"/>`,
      `<path d="M ${margin} ${margin} L ${margin} ${height - margin}" stroke="#64748B" stroke-width="1"/>`,
      `<g id="object-trajectory" tabindex="0"><path data-testid="physics-process-trail" d="${path}" fill="none" stroke="${trajectorySelected ? "#0F6CBD" : "#2563EB"}" stroke-width="${trajectorySelected ? 5 : 2.5}" stroke-linecap="round" stroke-linejoin="round"/><circle data-testid="physics-process-object" cx="${num(currentPoint.x)}" cy="${num(currentPoint.y)}" r="${trajectorySelected ? 8 : 6}" fill="#DC2626" stroke="#FFFFFF" stroke-width="2"/></g>`,
      ...eventMarkers,
      `<text x="${width - margin}" y="${height - 12}" text-anchor="end" fill="#475569" font-size="11">t = ${formatTime(currentFrame?.time ?? 0)} s</text>`,
      `</svg>`
    ].join("")
  };
}

export function PhysicsProcessRenderer({ rendered }: { rendered: PhysicsProcessRenderResult }): JSX.Element {
  const [frameIndex, setFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [parameterValues, setParameterValues] = useState<Record<string, number>>(() => Object.fromEntries(
    rendered.spec.parameters.map((parameter) => [parameter.id, parameter.value])
  ));
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<PhysicsProcessResultV1>(rendered);
  const [runtime, setRuntime] = useState<"fallback" | "loading" | "worker">("loading");
  const activeSpec = useMemo<PhysicsProcessSpecV1>(() => ({
    ...rendered.spec,
    parameters: rendered.spec.parameters.map((parameter) => ({
      ...parameter,
      value: parameterValues[parameter.id] ?? parameter.value
    }))
  }), [parameterValues, rendered.spec]);
  const activeRender = useMemo(
    () => projectPhysicsProcess(activeSpec, simulation, frameIndex, selectedObjectId),
    [activeSpec, frameIndex, selectedObjectId, simulation]
  );
  const lastFrame = Math.max(0, simulation.frames.length - 1);
  const currentFrame = simulation.frames[Math.min(frameIndex, lastFrame)] ?? simulation.frames[0];

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setRuntime("loading");
    void runPhysicsProcessWorker(activeSpec, controller.signal)
      .then((result) => {
        if (!active) return;
        setSimulation(result);
        setFrameIndex((current) => Math.min(current, Math.max(0, result.frames.length - 1)));
        setRuntime("worker");
      })
      .catch((error) => {
        if (!active || controller.signal.aborted) return;
        setSimulation(simulatePhysicsProcess(activeSpec, activeSpec.seed));
        setRuntime("fallback");
        void error;
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [activeSpec]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setFrameIndex((current) => {
        if (current >= lastFrame) {
          setIsPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, Math.max(16, 1000 / activeSpec.frameRate));
    return () => window.clearInterval(timer);
  }, [activeSpec.frameRate, isPlaying, lastFrame]);

  const moveToFrame = (nextFrame: number) => {
    setIsPlaying(false);
    setFrameIndex(Math.max(0, Math.min(lastFrame, nextFrame)));
  };

  return (
    <section
      aria-label={activeRender.accessibility.summary}
      className="visualization-physics-process visualization-process"
      data-runtime={runtime}
      data-testid="physics-process-runtime"
    >
      <div
        className="visualization-process__stage"
        data-current-x={currentFrame?.state.x ?? 0}
        data-current-y={currentFrame?.state.y ?? 0}
        data-testid="physics-process-stage"
        dangerouslySetInnerHTML={{ __html: activeRender.svg }}
      />
      <div aria-label="过程控制" className="visualization-process__toolbar">
        <Tooltip content="上一帧" relationship="label">
          <Button aria-label="上一帧" disabled={frameIndex === 0} icon={<PreviousRegular />} onClick={() => moveToFrame(frameIndex - 1)} size="small" />
        </Tooltip>
        <Tooltip content={isPlaying ? "暂停" : "播放"} relationship="label">
          <Button
            aria-label={isPlaying ? "暂停" : "播放"}
            disabled={lastFrame === 0}
            icon={isPlaying ? <PauseRegular /> : <PlayRegular />}
            onClick={() => {
              if (frameIndex >= lastFrame) setFrameIndex(0);
              setIsPlaying((current) => !current);
            }}
            size="small"
          />
        </Tooltip>
        <Tooltip content="下一帧" relationship="label">
          <Button aria-label="下一帧" disabled={frameIndex === lastFrame} icon={<NextRegular />} onClick={() => moveToFrame(frameIndex + 1)} size="small" />
        </Tooltip>
        <output data-testid="physics-process-frame">{frameIndex} / {lastFrame}</output>
      </div>
      <label className="visualization-process__timeline">
        <span>时间</span>
        <Slider
          aria-label="时间"
          max={lastFrame}
          min={0}
          onChange={(_, data) => moveToFrame(data.value)}
          step={1}
          value={Math.min(frameIndex, lastFrame)}
        />
        <output>{formatTime(currentFrame?.time ?? 0)} s</output>
      </label>
      {activeSpec.parameters.length > 0 ? (
        <div aria-label="物理参数" className="visualization-process__parameters">
          {activeSpec.parameters.map((parameter) => (
            <label className="visualization-process__parameter" key={parameter.id}>
              <span>{parameter.id}</span>
              <Slider
                aria-label={`参数 ${parameter.id}`}
                disabled={parameter.min === parameter.max}
                max={parameter.max}
                min={parameter.min}
                onChange={(_, data) => {
                  setIsPlaying(false);
                  setFrameIndex(0);
                  setParameterValues((current) => ({ ...current, [parameter.id]: data.value }));
                }}
                step={parameterStep(parameter.min, parameter.max)}
                value={parameter.value}
              />
              <output>{formatParameter(parameter.value, parameter.unit)}</output>
            </label>
          ))}
        </div>
      ) : null}
      <div aria-label="物理过程对象" className="visualization-process__objects">
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
      <table className="visualization-process__table">
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

export const physicsProcessVisualizationRenderer = {
  id: "physics-process-svg",
  modality: "physics_process",
  render(artifact: VisualizationArtifactV1) {
    if (artifact.spec.modality !== "physics_process") throw new Error("physics_process_artifact_invalid");
    return <PhysicsProcessRenderer rendered={renderPhysicsProcess(artifact.spec.payload)} />;
  },
  version: "1.0.0"
} as const;

function trajectoryBounds(frames: PhysicsProcessResultV1["frames"]) {
  const xValues = frames.map((frame) => frame.state.x ?? 0);
  const yValues = frames.map((frame) => frame.state.y ?? 0);
  const xMin = Math.min(...xValues, 0);
  const xMax = Math.max(...xValues, 1);
  const yMin = Math.min(...yValues, 0);
  const yMax = Math.max(...yValues, 1);
  const xPadding = Math.max((xMax - xMin) * 0.05, 0.1);
  const yPadding = Math.max((yMax - yMin) * 0.08, 0.1);
  return { xMax: xMax + xPadding, xMin: xMin - xPadding, yMax: yMax + yPadding, yMin: yMin - yPadding };
}

function renderGrid(): string[] {
  const lines: string[] = [];
  for (let index = 0; index <= 5; index += 1) {
    const x = margin + ((width - margin * 2) * index) / 5;
    lines.push(`<line x1="${num(x)}" y1="${margin}" x2="${num(x)}" y2="${height - margin}" stroke="#E2E8F0" stroke-width="1"/>`);
  }
  for (let index = 0; index <= 4; index += 1) {
    const y = margin + ((height - margin * 2) * index) / 4;
    lines.push(`<line x1="${margin}" y1="${num(y)}" x2="${width - margin}" y2="${num(y)}" stroke="#E2E8F0" stroke-width="1"/>`);
  }
  return lines;
}

function clampFrameIndex(frameIndex: number, frameCount: number): number {
  return Math.max(0, Math.min(Math.max(0, frameCount - 1), Math.round(frameIndex)));
}

function parameterStep(min: number, max: number): number {
  const range = max - min;
  if (range <= 0) return 1;
  return Number(Math.max(range / 100, 0.001).toPrecision(6));
}

function formatParameter(value: number, unit: string): string {
  return `${Number(value.toFixed(4))}${unit ? ` ${unit}` : ""}`;
}

function formatTime(value: number): string {
  return Number(value.toFixed(3)).toString();
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
