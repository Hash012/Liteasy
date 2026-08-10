import type { JSX } from "react";
import { useState } from "react";
import type { CircuitSpecV1 } from "../visualizationArtifact.types";
import { validateCircuit } from "../kernels/circuitKernel";
import { createSafeSvgScene } from "../rendering/safeSvgScene";

export type CircuitRenderResult = {
  selectableObjectIds: readonly string[];
  svg: string;
};

export function renderCircuit(spec: CircuitSpecV1): CircuitRenderResult {
  const result = validateCircuit(spec);
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

export function CircuitRenderer({ rendered }: { rendered: CircuitRenderResult }): JSX.Element {
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const componentIds = rendered.selectableObjectIds.filter((id) => !id.startsWith("wire-"));
  return (
    <section aria-label={componentIds.join(", ")} className="visualization-circuit">
      <div
        aria-label={componentIds.join(", ")}
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
