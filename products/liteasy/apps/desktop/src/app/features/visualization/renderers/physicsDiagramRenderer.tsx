import type { JSX } from "react";
import type { PhysicsDiagramSpecV1, VisualizationArtifactV1 } from "../visualizationArtifact.types";
import { validatePhysicsDiagram } from "../kernels/physicsDiagramKernel";
import { createSafeSvgScene } from "../rendering/safeSvgScene";

export type PhysicsDiagramRenderResult = {
  accessibility: { summary: string };
  selectableObjectIds: readonly string[];
  svg: string;
};

export function renderPhysicsDiagram(spec: PhysicsDiagramSpecV1): PhysicsDiagramRenderResult {
  const result = validatePhysicsDiagram(spec);
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

export function PhysicsDiagramRenderer({ rendered }: { rendered: PhysicsDiagramRenderResult }): JSX.Element {
  return (
    <section aria-label={rendered.accessibility.summary} className="visualization-physics-diagram">
      <div
        aria-label={rendered.accessibility.summary}
        dangerouslySetInnerHTML={{ __html: rendered.svg }}
      />
    </section>
  );
}

export const physicsDiagramVisualizationRenderer = {
  id: "physics-diagram-svg",
  modality: "physics_diagram",
  render(artifact: VisualizationArtifactV1) {
    if (artifact.spec.modality !== "physics_diagram") throw new Error("physics_diagram_artifact_invalid");
    return <PhysicsDiagramRenderer rendered={renderPhysicsDiagram(artifact.spec.payload)} />;
  },
  version: "1.0.0"
} as const;
