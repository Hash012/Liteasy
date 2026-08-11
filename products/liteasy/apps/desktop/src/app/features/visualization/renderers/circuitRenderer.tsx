import type { JSX } from "react";
import { useState } from "react";
import type { CircuitSpecV1, VisualizationArtifactV1 } from "../visualizationArtifact.types";
import { validateCircuit } from "../kernels/circuitKernel";
import { createSafeSvgScene } from "../rendering/safeSvgScene";

export type CircuitRenderResult = {
  accessibility: { summary: string };
  selectableObjectIds: readonly string[];
  svg: string;
};

export function renderCircuit(spec: CircuitSpecV1): CircuitRenderResult {
  const result = validateCircuit(spec);
  return {
    accessibility: { summary: result.semanticObjects.map((object) => object.label).join(", ") },
    selectableObjectIds: result.selectableObjectIds,
    svg: createSafeSvgScene({
      edges: result.layout.edges,
      height: result.layout.height,
      nodes: result.layout.nodes,
      width: result.layout.width
    }).svg
  };
}

export function CircuitRenderer({ rendered }: { rendered: CircuitRenderResult }): JSX.Element {
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  return (
    <section aria-label={rendered.accessibility.summary} className="visualization-circuit">
      <div
        aria-label={rendered.accessibility.summary}
        className="visualization-circuit__svg"
        dangerouslySetInnerHTML={{ __html: rendered.svg }}
      />
      <div aria-label="电路对象">
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
    </section>
  );
}

export const circuitVisualizationRenderer = {
  id: "circuit-svg",
  modality: "circuit",
  render(artifact: VisualizationArtifactV1) {
    if (artifact.spec.modality !== "circuit") throw new Error("circuit_artifact_invalid");
    return <CircuitRenderer rendered={renderCircuit(artifact.spec.payload)} />;
  },
  version: "1.0.0"
} as const;
