import type { JSX } from "react";
import { useState } from "react";
import type {
  AccessibilityProjectionV1,
  EvidenceBindingV1,
  InteractionContractV1,
  SemanticGraphSpecV1,
  SemanticObjectV1,
  VisualizationArtifactV1
} from "../visualizationArtifact.types";
import { validateSemanticGraph } from "../kernels/semanticGraphKernel";
import { createSafeSvgScene } from "../rendering/safeSvgScene";

export type SemanticGraphRenderContext = {
  evidenceBindings: readonly EvidenceBindingV1[];
  semanticObjects: readonly SemanticObjectV1[];
};

export type SemanticGraphRenderResult = {
  accessibility: AccessibilityProjectionV1;
  interaction: InteractionContractV1;
  selectableObjectIds: readonly string[];
  semanticObjects: readonly SemanticObjectV1[];
  svg: string;
};

function assertEvidenceBindings(result: ReturnType<typeof validateSemanticGraph>, evidenceBindings: readonly EvidenceBindingV1[]): void {
  if (evidenceBindings.length === 0) return;
  const known = new Set(evidenceBindings.map((binding) => binding.claimId));
  if (result.semanticObjects.some((object) => object.evidenceClaimIds.some((claimId) => !known.has(claimId)))) {
    throw new Error("semantic_graph_evidence_missing");
  }
}

export function renderSemanticGraph(spec: SemanticGraphSpecV1, context: SemanticGraphRenderContext): SemanticGraphRenderResult {
  const result = validateSemanticGraph(spec);
  assertEvidenceBindings(result, context.evidenceBindings);
  const scene = createSafeSvgScene({
    edges: result.layout.edges,
    height: result.layout.height,
    nodes: result.layout.nodes,
    width: result.layout.width
  });
  return {
    accessibility: result.accessibility,
    interaction: result.interaction,
    selectableObjectIds: result.interaction.selectableObjectIds,
    semanticObjects: context.semanticObjects.length > 0 ? context.semanticObjects : result.semanticObjects,
    svg: scene.svg
  };
}

export function SemanticGraphRenderer({ rendered }: { rendered: SemanticGraphRenderResult }): JSX.Element {
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const summary = rendered.semanticObjects.map((object) => object.label).join(", ");
  return (
    <section aria-label={summary} className="visualization-semantic-graph" data-testid="semantic-graph-renderer">
      <div
        aria-label={summary}
        className="visualization-semantic-graph__svg"
        dangerouslySetInnerHTML={{ __html: rendered.svg }}
        role="img"
      />
      <div aria-label="语义图对象" className="visualization-semantic-graph__objects">
        {rendered.semanticObjects.map((object) => (
          <button
            aria-pressed={selectedObjectId === object.objectId}
            data-object-id={object.objectId}
            key={object.objectId}
            onClick={() => setSelectedObjectId(object.objectId)}
            type="button"
          >
            {object.label}
          </button>
        ))}
      </div>
      <ol aria-label="语义图阅读顺序">
        {rendered.accessibility.objectReadingOrder.map((objectId) => {
          const object = rendered.semanticObjects.find((item) => item.objectId === objectId);
          return <li key={objectId}>{object?.label ?? objectId}</li>;
        })}
      </ol>
      <p>{rendered.accessibility.summary}</p>
    </section>
  );
}

export const semanticGraphVisualizationRenderer = {
  id: "semantic-graph-svg",
  modality: "semantic_graph",
  render(artifact: VisualizationArtifactV1) {
    if (artifact.spec.modality !== "semantic_graph") throw new Error("semantic_graph_artifact_invalid");
    return (
      <SemanticGraphRenderer
        rendered={renderSemanticGraph(artifact.spec.payload, {
          evidenceBindings: artifact.evidenceBindings,
          semanticObjects: artifact.semanticObjects
        })}
      />
    );
  },
  version: "1.0.0"
} as const;
