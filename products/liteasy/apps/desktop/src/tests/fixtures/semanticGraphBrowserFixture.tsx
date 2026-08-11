import type { SemanticGraphSpecV1 } from "../../app/features/visualization/visualizationArtifact.types";
import { SemanticGraphRenderer, renderSemanticGraph } from "../../app/features/visualization/renderers/semanticGraphRenderer";

const semanticGraphFixture = {
  subtype: "flowchart",
  nodes: [
    { id: "start", label: "输入", kind: "step", objectPath: ["start"], evidenceClaimIds: ["claim-1"] },
    { id: "end", label: "输出", kind: "step", objectPath: ["end"], evidenceClaimIds: ["claim-1"] }
  ],
  edges: [{ id: "edge-1", from: "start", to: "end", kind: "precedes", evidenceClaimIds: ["claim-1"] }],
  groups: [],
  hierarchy: [],
  timeOrder: [],
  claims: [{ id: "claim-1", text: "输入先于输出", evidenceIds: ["evidence-1"] }]
} as const satisfies SemanticGraphSpecV1;

export default function SemanticGraphBrowserFixture() {
  const rendered = renderSemanticGraph(semanticGraphFixture, {
    evidenceBindings: [{ claimId: "claim-1", confidence: "direct", evidenceIds: ["evidence-1"] }],
    semanticObjects: []
  });

  return (
    <main data-testid="semantic-graph-browser-fixture">
      <SemanticGraphRenderer rendered={rendered} />
      <output data-testid="semantic-graph-scene-metadata">
        {rendered.accessibility.objectReadingOrder.join(",")}|{rendered.selectableObjectIds.join(",")}
      </output>
    </main>
  );
}
