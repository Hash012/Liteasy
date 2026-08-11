import { Button, Tooltip } from "@fluentui/react-components";
import { ArrowResetRegular } from "@fluentui/react-icons";
import type { ComponentType, JSX } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Geometry3DSpecV1, VisualizationArtifactV1 } from "../visualizationArtifact.types";
import type { Geometry3DSolveResultV1 } from "../kernels/geometry3dKernel";
import { solveGeometry3D } from "../kernels/geometry3dKernel";
import { runGeometry3DWorker } from "../workers/geometry3d.worker";
import "./geometry3dRenderer.css";

export type Geometry3DRenderResult = Geometry3DSolveResultV1 & {
  selectableObjectIds: readonly string[];
  spec: Geometry3DSpecV1;
  svg: string;
};

type Geometry3DCanvasComponent = ComponentType<{
  onFailure: (diagnostic: string) => void;
  onReady: () => void;
  onSelect: (objectId: string) => void;
  resetToken: number;
  result: Geometry3DSolveResultV1;
  selectedObjectId: string | null;
  spec: Geometry3DSpecV1;
}>;

type GeometryRuntime = "fallback" | "loading" | "webgl";

const width = 560;
const height = 420;
const margin = 36;

export function renderGeometry3D(spec: Geometry3DSpecV1, selectedObjectId: string | null = null): Geometry3DRenderResult {
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
        const projectedVertex = scale(project(vertex).x, project(vertex).y);
        return `${index === 0 ? "M" : "L"} ${num(projectedVertex.x)} ${num(projectedVertex.y)}`;
      })
      .join(" ");
    const selected = selectedObjectId === section.id;
    return `<g id="object-${escapeText(section.id)}" tabindex="0"><path d="${path} Z" fill="#FECACA" fill-opacity="${selected ? 0.7 : 0.42}" stroke="${selected ? "#7F1D1D" : "#DC2626"}" stroke-width="${selected ? 4 : 2}"/><text x="${margin}" y="${height - 14}" fill="#111827">${escapeText(section.id)}</text></g>`;
  });
  const objectGroups = spec.objects.map((object) => {
    const selected = selectedObjectId === object.id;
    const edgePaths = meshEdges(object.faces ?? []).map(([aIndex, bIndex]) => {
      const a = scale(project(object.vertices[aIndex]).x, project(object.vertices[aIndex]).y);
      const b = scale(project(object.vertices[bIndex]).x, project(object.vertices[bIndex]).y);
      return `<path d="M ${num(a.x)} ${num(a.y)} L ${num(b.x)} ${num(b.y)}" fill="none" stroke="${selected ? "#0F172A" : "#2563EB"}" stroke-width="${selected ? 4 : 2}"/>`;
    });
    const vertices = object.vertices.map((vertex) => {
      const projectedVertex = scale(project(vertex).x, project(vertex).y);
      return `<circle cx="${num(projectedVertex.x)}" cy="${num(projectedVertex.y)}" r="${selected ? 5 : 3}" fill="#2563EB"/>`;
    });
    return `<g id="object-${escapeText(object.id)}" tabindex="0"><title>${escapeText(object.id)}</title>${edgePaths.join("")}${vertices.join("")}</g>`;
  });
  const selectableObjectIds = solved.interaction.selectableObjectIds;

  return {
    ...solved,
    selectableObjectIds,
    spec,
    svg: [
      `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="max-width:100%;height:auto;display:block" role="img" aria-label="${escapeText(selectableObjectIds.join(", "))}" xmlns="http://www.w3.org/2000/svg">`,
      `<rect x="0" y="0" width="${width}" height="${height}" fill="#F8FAFC"/>`,
      `<path d="M ${margin} ${height - margin} L ${width - margin} ${height - margin} L ${width - margin - 48} ${height - margin - 48}" fill="none" stroke="#CBD5E1" stroke-width="1"/>`,
      ...objectGroups,
      ...sections,
      `</svg>`
    ].join("")
  };
}

export function Geometry3DRenderer({ rendered }: { rendered: Geometry3DRenderResult }): JSX.Element {
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [workerResult, setWorkerResult] = useState<Geometry3DSolveResultV1 | null>(null);
  const [CanvasComponent, setCanvasComponent] = useState<Geometry3DCanvasComponent | null>(null);
  const [runtime, setRuntime] = useState<GeometryRuntime>("loading");
  const [runtimeDiagnostic, setRuntimeDiagnostic] = useState("");
  const [resetToken, setResetToken] = useState(0);
  const fallback = useMemo(() => renderGeometry3D(rendered.spec, selectedObjectId), [rendered.spec, selectedObjectId]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setRuntime("loading");
    setRuntimeDiagnostic("");
    setWorkerResult(null);
    setCanvasComponent(null);
    void runGeometry3DWorker(rendered.spec, controller.signal)
      .then(async (result) => {
        const module = await import("./Geometry3DCanvas");
        if (!active) return;
        setWorkerResult(result);
        setCanvasComponent(() => module.Geometry3DCanvas);
      })
      .catch((error) => {
        if (!active) return;
        setRuntimeDiagnostic(error instanceof Error ? error.message : "geometry_worker_failed");
        setRuntime("fallback");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [rendered.spec]);

  const handleReady = useCallback(() => {
    setRuntimeDiagnostic("");
    setRuntime("webgl");
  }, []);
  const handleFailure = useCallback((diagnostic: string) => {
    setRuntimeDiagnostic(diagnostic);
    setRuntime("fallback");
  }, []);
  const handleSelect = useCallback((objectId: string) => setSelectedObjectId(objectId), []);

  return (
    <section
      aria-label={fallback.accessibility.summary}
      className="visualization-geometry-3d"
      data-diagnostic={runtimeDiagnostic}
      data-runtime={runtime}
      data-testid="geometry-3d-runtime"
    >
      <div aria-label="三维几何视图控制" className="visualization-geometry-3d__toolbar">
        <Tooltip content="重置相机" relationship="label">
          <Button
            appearance="subtle"
            aria-label="重置三维几何视图"
            icon={<ArrowResetRegular />}
            onClick={() => setResetToken((current) => current + 1)}
            size="small"
          />
        </Tooltip>
      </div>
      <div className="visualization-geometry-3d__stage">
        <div
          aria-hidden={runtime === "webgl"}
          className="visualization-geometry-3d__fallback"
          hidden={runtime === "webgl"}
          dangerouslySetInnerHTML={{ __html: fallback.svg }}
        />
        {CanvasComponent && workerResult && runtime !== "fallback" ? (
          <CanvasComponent
            onFailure={handleFailure}
            onReady={handleReady}
            onSelect={handleSelect}
            resetToken={resetToken}
            result={workerResult}
            selectedObjectId={selectedObjectId}
            spec={rendered.spec}
          />
        ) : null}
      </div>
      <div aria-label="三维对象" className="visualization-geometry-3d__objects">
        {fallback.selectableObjectIds.map((id) => (
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
      <table className="visualization-geometry-3d__table">
        <tbody>
          {fallback.accessibility.dataTable?.map((row) => (
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

function project(vertex: readonly [number, number, number]): { x: number; y: number } {
  return { x: vertex[0] - vertex[1] * 0.35, y: vertex[2] + vertex[1] * 0.35 };
}

function meshEdges(faces: readonly number[][]): Array<[number, number]> {
  const edges = new Set<string>();
  for (const face of faces) {
    for (let index = 0; index < face.length; index += 1) {
      const a = face[index];
      const b = face[(index + 1) % face.length];
      edges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
    }
  }
  return [...edges].map((edge) => edge.split(":").map(Number) as [number, number]);
}

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
