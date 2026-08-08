import type { BuiltinSkillPackageV1 } from "../../app/features/skills/builtinSkill.types";
import type { VisualizationArtifactV1, VisualizationModality } from "../../app/features/visualization/visualizationArtifact.types";
import type { ValidationReportV1 } from "../../app/features/visualization/visualizationArtifact.types";
import type { VisualizationWorkflowInput } from "../../app/features/visualization/visualizationWorkflowHarness";

const validation: ValidationReportV1 = {
  checks: [{ gate: "hard", outcome: "pass", validatorId: "schema-identity", validatorVersion: "1.0.0" }],
  outcome: "pass",
  repairCount: 0
};

const skill: BuiltinSkillPackageV1 = {
  instructions: "Use the constrained visualization artifact contract.",
  manifest: {
    costClass: "low",
    evidenceRequirements: ["evidence_claims"],
    fallbackModalities: ["source_figure"],
    id: "semantic-graph",
    integrityRules: ["hard_gates_only"],
    modality: "semantic_graph",
    outputSchemaId: "liteasy.visualization/v1",
    remote: false,
    rendererId: "safe-svg",
    runtimeVersion: "liteasy.visualization-runtime/v1",
    styleLock: ["no_dynamic_scripts"],
    validatorIds: ["schema-identity", "evidence-claims", "stable-object-ids", "interaction-allowlist", "resource-limits", "accessibility-reading-order"],
    version: "1.0.0"
  }
};

function makeArtifact(modality: VisualizationModality, validEvidence: boolean): VisualizationArtifactV1 {
  const source = modality === "source_figure";
  const semanticObjects = source || !validEvidence ? (source ? [] : [{
    evidenceClaimIds: [],
    kind: "process",
    label: "Start",
    objectId: "start",
    objectPath: ["start"],
    selectable: true
  }]) : [{
    evidenceClaimIds: ["claim-1"],
    kind: "process",
    label: "Start",
    objectId: "start",
    objectPath: ["start"],
    selectable: true
  }];
  const spec = source
    ? { modality: "source_figure" as const, payload: { caption: "Fixture source figure", extraction: { confidence: 1, method: "fixture" }, imageRef: "asset-fixture", page: 1, paperId: "paper-fixture", regions: [], sourceFigureId: "figure-fixture" } }
    : { modality: "semantic_graph" as const, payload: { claims: [{ id: "claim-1", text: "Fixture claim", evidenceIds: validEvidence ? ["evidence-1"] : [] }], edges: [], groups: [], hierarchy: [], nodes: [{ id: "start", kind: "process", label: "Start", objectPath: ["start"], ...(validEvidence ? { evidenceClaimIds: ["claim-1"] } : {}) }], subtype: "flowchart" as const, timeOrder: [] } };
  return {
    accessibility: { objectReadingOrder: semanticObjects.map((object) => object.objectId), summary: "Fixture visualization" },
    artifactId: source ? "source-figure-fixture" : "generated-fixture",
    artifactVersion: "liteasy.visualization/v1",
    createdAt: "2026-08-09T00:00:00.000Z",
    evidenceBindings: source ? [{ claimId: "source-claim", confidence: "direct", evidenceIds: ["figure-evidence"], sourceFigureId: "figure-fixture" }] : (validEvidence ? [{ claimId: "claim-1", confidence: "direct", evidenceIds: ["evidence-1"] }] : []),
    fallbackHistory: [],
    implementation: { rendererId: source ? "source-figure" : "safe-svg", rendererVersion: "1.0.0", skillId: source ? "source-figure" : "semantic-graph", skillVersion: "1.0.0" },
    interaction: { pan: true, parameterIds: [], playback: "none", rotate: false, selectableObjectIds: semanticObjects.filter((object) => object.selectable).map((object) => object.objectId), zoom: true },
    locale: "en-US",
    modality,
    nodeId: "node-fixture",
    semanticObjects,
    spec,
    usage: { costPolicyVersion: "1", ledgerId: "ledger-fixture", providerRouteId: "route-fixture", reservationId: "reservation-fixture", reservedUnits: 1, settledUnits: 1 },
    validation
  };
}

export const invalidDraft = makeArtifact("semantic_graph", false);
export const stillInvalidDraft = makeArtifact("semantic_graph", false);
export const validSourceFigure = makeArtifact("source_figure", true);

export type VisualizationWorkflowFixtureOverrides = Partial<Omit<VisualizationWorkflowInput, "repair">> & {
  generate?: VisualizationWorkflowInput["generate"];
  repair?: VisualizationWorkflowInput["repair"];
  fallback?: VisualizationWorkflowInput["fallback"];
};

export function makeVisualizationWorkflowFixture(overrides: VisualizationWorkflowFixtureOverrides = {}): VisualizationWorkflowInput {
  const { fallback, generate, repair, ...rest } = overrides;
  return {
    artifactId: "workflow-fixture",
    fallback: fallback ?? (async () => validSourceFigure),
    generate: generate ?? (async () => makeArtifact("semantic_graph", true)),
    repair: repair ?? (async (draft) => draft),
    runId: "run-fixture",
    skill,
    ...rest
  };
}
