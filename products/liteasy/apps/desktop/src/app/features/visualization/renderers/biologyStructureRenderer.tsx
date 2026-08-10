import type { JSX } from "react";
import { useState } from "react";
import type { BiologyStructureSpecV1, VisualizationArtifactV1 } from "../visualizationArtifact.types";
import { validateBiologyStructure } from "../kernels/biologyStructureKernel";
import { createSafeSvgScene } from "../rendering/safeSvgScene";

export type BiologyStructureRenderResult = {
  selectableObjectIds: readonly string[];
  svg: string;
};

export function renderBiologyStructure(spec: BiologyStructureSpecV1): BiologyStructureRenderResult {
  const result = validateBiologyStructure(spec);
  const structureLabels = result.semanticObjects
    .filter((object) => object.kind.startsWith("liteasy:"))
    .map((object) => object.label);
  return {
    selectableObjectIds: result.selectableObjectIds,
    svg: createSafeSvgScene({
      description: structureLabels.join(", "),
      edges: result.layout.edges,
      height: result.layout.height,
      nodes: result.layout.nodes,
      width: result.layout.width
    }).svg
  };
}

export function BiologyStructureRenderer({ rendered }: { rendered: BiologyStructureRenderResult }): JSX.Element {
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  return (
    <section aria-label={rendered.selectableObjectIds.join(", ")} className="visualization-biology-structure">
      <div dangerouslySetInnerHTML={{ __html: rendered.svg }} />
      <div aria-label="生物结构对象">
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

export const biologyStructureVisualizationRenderer = {
  id: "biology-structure-svg",
  modality: "biology_structure",
  render(artifact: VisualizationArtifactV1) {
    if (artifact.spec.modality !== "biology_structure") throw new Error("biology_structure_artifact_invalid");
    return <BiologyStructureRenderer rendered={renderBiologyStructure(artifact.spec.payload)} />;
  },
  version: "1.0.0"
} as const;
