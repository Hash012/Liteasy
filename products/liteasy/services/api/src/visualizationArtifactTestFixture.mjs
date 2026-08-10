export function canonicalVisualizationArtifact(overrides = {}) {
  const artifact = {
    accessibility: { objectReadingOrder: ["start"], summary: "A flowchart." },
    artifactId: "artifact_1",
    artifactVersion: "liteasy.visualization/v1",
    createdAt: "2026-08-10T00:00:00.000Z",
    evidenceBindings: [],
    fallbackHistory: [],
    implementation: {
      rendererId: "safe-svg",
      rendererVersion: "1.0.0",
      skillId: "semantic-graph",
      skillVersion: "1.0.0"
    },
    interaction: {
      pan: true,
      parameterIds: [],
      playback: "none",
      rotate: false,
      selectableObjectIds: ["start"],
      zoom: true
    },
    locale: "zh-CN",
    modality: "semantic_graph",
    nodeId: "node_1",
    semanticObjects: [{
      evidenceClaimIds: [],
      kind: "process",
      label: "Start",
      objectId: "start",
      objectPath: ["start"],
      selectable: true
    }],
    spec: {
      modality: "semantic_graph",
      payload: {
        claims: [],
        edges: [],
        groups: [],
        hierarchy: [],
        nodes: [{ id: "start", kind: "process", label: "Start", objectPath: ["start"] }],
        subtype: "flowchart",
        timeOrder: []
      }
    },
    usage: {
      costPolicyVersion: "1",
      ledgerId: "ledger_1",
      providerRouteId: "route_1",
      reservationId: "reservation_1",
      reservedUnits: 1,
      settledUnits: 1
    },
    validation: {
      checks: [{
        gate: "hard",
        outcome: "pass",
        validatorId: "artifact-schema",
        validatorVersion: "1.0.0"
      }],
      outcome: "pass",
      repairCount: 0
    }
  };
  return { ...artifact, ...overrides };
}

export function visualizationPublicationEnvelope(body = canonicalVisualizationArtifact(), overrides = {}) {
  return {
    artifactId: body.artifactId,
    body,
    contentHash: null,
    evidenceHash: "a".repeat(64),
    modality: body.modality,
    nodeId: body.nodeId,
    specHash: "b".repeat(64),
    state: "ready",
    ...overrides
  };
}
