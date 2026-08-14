import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { VisualizationArtifactCompilerRegistry } from "./visualizationArtifactCompiler.mjs";
import { productionStaticScienceVisualizationCompilers } from "./staticScienceVisualizationCompilers.mjs";

const fixture = JSON.parse(await readFile(new URL(
  "../../../../../development/test-data/thin-reading-multimodal/static-science-conformance.v1.json",
  import.meta.url
), "utf8"));

const staticModalities = ["biology_structure", "circuit", "physics_diagram", "semantic_graph"];
const catalog = {
  entries: staticModalities.map((modality) => ({
    enabled: true,
    generated: true,
    modality,
    skillId: productionStaticScienceVisualizationCompilers[modality]?.implementation?.skillId
  })),
  version: "liteasy.visualization-builtins/v1"
};

const reservation = {
  artifactId: "artifact-static-1",
  policyRevision: 1,
  reservationId: "reservation-static-1",
  reservedUnits: 1,
  routeId: "route-static-1"
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

test("provides a production compiler for every static catalog candidate", () => {
  assert.deepEqual(Object.keys(productionStaticScienceVisualizationCompilers).sort(), staticModalities);
});

test("derives static provider proposal fields from the publication schema", () => {
  for (const modality of staticModalities) {
    const schema = productionStaticScienceVisualizationCompilers[modality].proposalSchema;
    assert.deepEqual(schema.properties.evidenceBindings.items.required, ["claimId", "evidenceIds", "confidence"]);
    assert.deepEqual(schema.properties.semanticObjects.items.required, [
      "objectId", "kind", "label", "objectPath", "evidenceClaimIds", "selectable"
    ]);
    assert.equal(schema.properties.spec.properties.modality.const, modality);
    assert.equal(schema.properties.spec.properties.payload.type, "object");
  }
});

test("constrains provider evidence references to the resolved source IDs", () => {
  const registry = new VisualizationArtifactCompilerRegistry({
    catalog,
    compilers: productionStaticScienceVisualizationCompilers
  });
  const allowed = fixture.source.evidence.map(({ id }) => id);
  const schema = registry.providerPayload("semantic_graph", fixture.source).schema;
  assert.deepEqual(schema.properties.evidenceBindings.items.properties.evidenceIds.items.enum, allowed);
  assert.deepEqual(schema.properties.spec.properties.payload.properties.claims.items.properties.evidenceIds.items.enum, allowed);
});

test("compiles valid static science conformance proposals", async () => {
  const registry = new VisualizationArtifactCompilerRegistry({
    catalog,
    compilers: productionStaticScienceVisualizationCompilers,
    now: () => new Date("2026-08-10T08:00:00.000Z")
  });
  assert.deepEqual(registry.availableModalities().sort(), staticModalities);
  for (const modality of staticModalities) {
    const artifact = await registry.compile(input(modality, fixture.modalities[modality].valid));
    assert.equal(artifact.modality, modality);
    assert.equal(artifact.validation.outcome, "pass");
    assert.equal(artifact.implementation.skillId, catalog.entries.find((entry) => entry.modality === modality).skillId);
  }
});

test("rejects schema-valid proposals that fail static domain hard gates", async () => {
  const registry = new VisualizationArtifactCompilerRegistry({
    catalog,
    compilers: productionStaticScienceVisualizationCompilers,
    now: () => new Date("2026-08-10T08:00:00.000Z")
  });
  for (const modality of staticModalities) {
    const invalid = fixture.modalities[modality].invalid.domain;
    const proposal = mergePatch(fixture.modalities[modality].valid, invalid.patch);
    await assert.rejects(
      () => registry.compile(input(modality, proposal)),
      /visualization_hard_validation_failed/
    );
  }
});
