import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { VisualizationArtifactCompilerRegistry } from "./visualizationArtifactCompiler.mjs";
import { productionInteractiveMathVisualizationCompilers } from "./interactiveMathVisualizationCompilers.mjs";

const fixture = JSON.parse(await readFile(new URL(
  "../../../../../development/test-data/thin-reading-multimodal/interactive-math-conformance.v1.json",
  import.meta.url
), "utf8"));

const mathModalities = ["function_plot", "geometry_2d", "geometry_3d"];
const catalog = {
  entries: mathModalities.map((modality) => ({
    enabled: true,
    generated: true,
    modality,
    skillId: productionInteractiveMathVisualizationCompilers[modality]?.implementation?.skillId
  })),
  version: "liteasy.visualization-builtins/v1"
};

const reservation = {
  artifactId: "artifact-math-1",
  policyRevision: 1,
  reservationId: "reservation-math-1",
  reservedUnits: 1,
  routeId: "route-math-1"
};

function mergePatch(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const output = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    output[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergePatch(base?.[key], value)
      : value;
  }
  return output;
}

function input(modality, proposal) {
  return {
    locale: "zh-CN",
    modality,
    nodeId: fixture.source.nodeId,
    proposal,
    reservation: { ...reservation, artifactId: `artifact-${modality}` },
    source: fixture.source
  };
}

test("provides a production compiler for every interactive math catalog candidate", () => {
  assert.deepEqual(Object.keys(productionInteractiveMathVisualizationCompilers).sort(), mathModalities);
});

test("derives math provider proposal fields from the publication schema", () => {
  for (const modality of mathModalities) {
    const schema = productionInteractiveMathVisualizationCompilers[modality].proposalSchema;
    assert.deepEqual(schema.properties.evidenceBindings.items.required, ["claimId", "evidenceIds", "confidence"]);
    assert.deepEqual(schema.properties.semanticObjects.items.required, [
      "objectId", "kind", "label", "objectPath", "evidenceClaimIds", "selectable"
    ]);
    assert.equal(schema.properties.spec.properties.modality.const, modality);
    assert.equal(schema.properties.spec.properties.payload.type, "object");
  }
});

test("compiles valid interactive math conformance proposals", async () => {
  const registry = new VisualizationArtifactCompilerRegistry({
    catalog,
    compilers: productionInteractiveMathVisualizationCompilers,
    now: () => new Date("2026-08-11T08:00:00.000Z")
  });
  assert.deepEqual(registry.availableModalities().sort(), mathModalities);
  for (const modality of mathModalities) {
    const artifact = await registry.compile(input(modality, fixture.modalities[modality].valid));
    assert.equal(artifact.modality, modality);
    assert.equal(artifact.validation.outcome, "pass");
    assert.equal(artifact.implementation.skillId, catalog.entries.find((entry) => entry.modality === modality).skillId);
  }
});

test("rejects schema-valid proposals that fail interactive math hard gates", async () => {
  const registry = new VisualizationArtifactCompilerRegistry({
    catalog,
    compilers: productionInteractiveMathVisualizationCompilers,
    now: () => new Date("2026-08-11T08:00:00.000Z")
  });
  for (const modality of mathModalities) {
    const invalid = fixture.modalities[modality].invalid.domain;
    const proposal = mergePatch(fixture.modalities[modality].valid, invalid.patch);
    await assert.rejects(
      () => registry.compile(input(modality, proposal)),
      /visualization_hard_validation_failed/
    );
  }
});
