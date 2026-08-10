import assert from "node:assert/strict";
import test from "node:test";
import { validateVisualizationArtifact } from "./visualizationArtifactValidator.mjs";
import {
  canonicalVisualizationArtifact,
  visualizationPublicationEnvelope
} from "./visualizationArtifactTestFixture.mjs";

test("rejects a structurally invalid artifact before publication", () => {
  const body = canonicalVisualizationArtifact({
    spec: { modality: "semantic_graph", payload: { nodes: "not-an-array" } }
  });
  const result = validateVisualizationArtifact({
    artifact: visualizationPublicationEnvelope(body),
    modality: "semantic_graph",
    phase: "publication"
  });
  assert.equal(result.outcome, "fail");
  assert.equal(result.reasonCode, "artifact_schema_invalid");
});

test("rejects envelope and body modality inconsistencies", () => {
  const body = canonicalVisualizationArtifact();
  const result = validateVisualizationArtifact({
    artifact: visualizationPublicationEnvelope(body, { modality: "circuit" }),
    modality: "circuit",
    phase: "publication"
  });
  assert.equal(result.outcome, "fail");
  assert.equal(result.reasonCode, "artifact_modality_invalid");
});

test("rejects hard-gate inconsistencies", () => {
  const body = canonicalVisualizationArtifact({
    validation: {
      checks: [{
        gate: "hard",
        outcome: "warning",
        validatorId: "artifact-schema",
        validatorVersion: "1.0.0"
      }],
      outcome: "degraded",
      repairCount: 0
    }
  });
  const result = validateVisualizationArtifact({
    artifact: visualizationPublicationEnvelope(body),
    modality: "semantic_graph",
    phase: "publication"
  });
  assert.equal(result.outcome, "fail");
  assert.equal(result.reasonCode, "artifact_hard_gate_invalid");
});

test("retains the bounded provider-result contract", () => {
  assert.equal(validateVisualizationArtifact({
    phase: "provider_result",
    providerResult: { text: "structured proposal" }
  }).outcome, "pass");
});
