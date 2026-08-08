export type VisualizationArtifactFixtureOverrides = {
  modality?: string;
  validation?: { outcome: "pass" | "degraded" | "fail" };
};

export function makeVisualizationArtifactFixture(
  overrides: VisualizationArtifactFixtureOverrides = {}
): Record<string, unknown> {
  const modality = overrides.modality ?? "semantic_graph";
  const payload = modality === "semantic_graph"
    ? {
        subtype: "flowchart",
        nodes: [{ id: "start", label: "Start", kind: "process", objectPath: ["start"] }],
        edges: [],
        groups: [],
        hierarchy: [],
        timeOrder: [],
        claims: []
      }
    : modality === "circuit"
      ? { components: [], wires: [], networks: [], parameters: [], measurementPoints: [], currents: [], voltages: [] }
      : modality === "physics_diagram"
        ? { objects: [], vectors: [], rays: [], constraints: [], annotations: [] }
        : modality === "biology_structure"
          ? { ontologyVersion: "1", structures: [], regions: [], connections: [] }
          : modality === "geometry_2d"
            ? { objects: [], constraints: [], viewport: { xMin: -1, xMax: 1, yMin: -1, yMax: 1 } }
            : modality === "function_plot"
              ? { expression: "x", variable: "x", domain: { min: -1, max: 1 }, parameters: [], axes: { xLabel: "x", yLabel: "f(x)" }, keyPoints: [], auxiliaryCurves: [] }
              : modality === "geometry_3d"
                ? { objects: [], constraints: [], sections: [], camera: { position: [0, 0, 5], target: [0, 0, 0], minDistance: 1, maxDistance: 10 } }
                : modality === "physics_process"
                  ? { duration: 1, frameRate: 30, initialState: { x: 0 }, parameters: [], equations: [], events: [], invariants: [], errorTolerance: 0.01, evidenceBindings: [] }
                  : modality === "reaction_process"
                    ? { species: [], steps: [], conditions: [], atomMap: [] }
                    : modality === "raster_illustration"
                      ? { visualSchema: "fixture", composition: { width: 100, height: 100, aspectRatio: 1 }, labels: [], styleLock: { palette: ["black"], typography: "sans", prohibitDecorativeClaims: true }, evidenceClaimIds: [] }
                      : { sourceFigureId: "figure-fixture", paperId: "paper-fixture", page: 1, caption: "Fixture figure", imageRef: "asset-fixture", regions: [], extraction: { method: "fixture", confidence: 1 } };

  return {
    artifactId: "viz-fixture",
    artifactVersion: "liteasy.visualization/v1",
    modality,
    nodeId: "node-fixture",
    locale: "zh-CN",
    implementation: {
      skillId: "semantic-graph",
      skillVersion: "1.0.0",
      rendererId: "safe-svg",
      rendererVersion: "1.0.0"
    },
    spec: { modality, payload },
    evidenceBindings: [],
    semanticObjects: [{
      objectId: "start",
      kind: "process",
      label: "Start",
      objectPath: ["start"],
      evidenceClaimIds: [],
      selectable: true
    }],
    interaction: {
      pan: true,
      zoom: true,
      rotate: false,
      playback: "none",
      parameterIds: [],
      selectableObjectIds: ["start"]
    },
    accessibility: {
      summary: "A flowchart.",
      objectReadingOrder: ["start"]
    },
    validation: {
      outcome: overrides.validation?.outcome ?? "pass",
      checks: [{
        gate: "hard",
        validatorId: "artifact-schema",
        validatorVersion: "1.0.0",
        outcome: "pass"
      }],
      repairCount: 0
    },
    fallbackHistory: [],
    usage: {
      ledgerId: "ledger-fixture",
      reservationId: "reservation-fixture",
      providerRouteId: "route-fixture",
      costPolicyVersion: "1",
      reservedUnits: 1,
      settledUnits: 1
    },
    createdAt: "2026-08-09T00:00:00.000Z"
  };
}
