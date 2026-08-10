import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateVisualizationArtifact } from "./visualizationArtifactValidator.mjs";
import {
  canonicalVisualizationArtifact,
  visualizationPublicationEnvelope
} from "./visualizationArtifactTestFixture.mjs";

test("loads the committed canonical artifact schema", async () => {
  const schema = JSON.parse(await readFile(new URL(
    "../../../packages/shared/visualizationArtifact.v1.schema.json",
    import.meta.url
  ), "utf8"));
  assert.equal(schema.$id, "liteasy.visualization/v1");
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.additionalProperties, false);
});

test("accepts the checked-in valid artifact contract", () => {
  const result = validateVisualizationArtifact({
    artifact: visualizationPublicationEnvelope(),
    modality: "semantic_graph",
    phase: "publication"
  });
  assert.equal(result.outcome, "pass");
});

test("rejects unknown fields and malformed modality payloads", () => {
  const unknownField = canonicalVisualizationArtifact({ script: "alert(1)" });
  const malformedPayload = canonicalVisualizationArtifact({
    spec: { modality: "semantic_graph", payload: { nodes: "not-an-array" } }
  });
  for (const body of [unknownField, malformedPayload]) {
    const result = validateVisualizationArtifact({
      artifact: visualizationPublicationEnvelope(body),
      modality: "semantic_graph",
      phase: "publication"
    });
    assert.equal(result.outcome, "fail");
    assert.equal(result.reasonCode, "artifact_schema_invalid");
  }
});

test("rejects envelope identity drift", () => {
  const result = validateVisualizationArtifact({
    artifact: visualizationPublicationEnvelope(undefined, { nodeId: "other_node" }),
    modality: "semantic_graph",
    phase: "publication"
  });
  assert.equal(result.outcome, "fail");
  assert.equal(result.reasonCode, "artifact_identity_invalid");
});
