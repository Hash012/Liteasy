import type { JSX } from "react";
import type { PhysicsDiagramSpecV1 } from "../visualizationArtifact.types";
import { validatePhysicsDiagram } from "../kernels/physicsDiagramKernel";
import { createSafeSvgScene } from "../rendering/safeSvgScene";

export type PhysicsDiagramRenderResult = {
  selectableObjectIds: readonly string[];
  svg: string;
};

export function renderPhysicsDiagram(spec: PhysicsDiagramSpecV1): PhysicsDiagramRenderResult {
  const result = validatePhysicsDiagram(spec);
  return {
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
    <section aria-label={rendered.selectableObjectIds.join(", ")} className="visualization-physics-diagram">
      <div
        aria-label={rendered.selectableObjectIds.join(", ")}
        dangerouslySetInnerHTML={{ __html: rendered.svg }}
      />
    </section>
  );
}
