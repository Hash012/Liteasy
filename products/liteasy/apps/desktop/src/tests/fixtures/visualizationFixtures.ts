import type { VisualizationArtifactV1, SemanticObjectV1 } from "../../app/features/visualization/visualizationArtifact.types";

export const artifactWithSelectedObject: VisualizationArtifactV1 = {
  artifactId: "viz-deep-dive",
  artifactVersion: "liteasy.visualization/v1",
  modality: "semantic_graph",
  nodeId: "node-1",
  locale: "zh-CN",
  spec: {
    modality: "semantic_graph",
    payload: {
      subtype: "flowchart",
      nodes: [{ id: "object-1", kind: "process", label: "Object", objectPath: ["object-1"], evidenceClaimIds: ["claim-1"] }],
      edges: [], groups: [], hierarchy: [], timeOrder: [],
      claims: [{ id: "claim-1", text: "Supported claim", evidenceIds: ["e-1"] }]
    }
  },
  implementation: { skillId: "fixture", skillVersion: "1", rendererId: "fixture", rendererVersion: "1" },
  evidenceBindings: [{ claimId: "claim-1", evidenceIds: ["e-1"], confidence: "direct" }],
  semanticObjects: [{ objectId: "object-1", kind: "process", label: "Object", objectPath: ["object-1"], evidenceClaimIds: ["claim-1"], selectable: true }],
  interaction: { pan: false, zoom: false, rotate: false, playback: "none", parameterIds: [], selectableObjectIds: ["object-1"] },
  accessibility: { summary: "Fixture", objectReadingOrder: ["object-1"] },
  validation: { outcome: "pass", checks: [], repairCount: 0 },
  fallbackHistory: [],
  usage: { ledgerId: "ledger", reservationId: "reservation", providerRouteId: "route", costPolicyVersion: "1", reservedUnits: 1, settledUnits: 1 },
  createdAt: "2026-08-10T00:00:00.000Z"
};
export const unknownObject: SemanticObjectV1 = {
  objectId: "unknown-object",
  kind: "process",
  label: "Unknown",
  objectPath: ["unknown-object"],
  evidenceClaimIds: ["claim-missing"],
  selectable: true
};
