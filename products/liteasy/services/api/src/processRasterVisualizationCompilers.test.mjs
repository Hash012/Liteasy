import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { VisualizationArtifactCompilerRegistry } from "./visualizationArtifactCompiler.mjs";
import { productionProcessRasterVisualizationCompilers } from "./processRasterVisualizationCompilers.mjs";

const fixture = JSON.parse(await readFile(new URL(
  "../../../../../development/test-data/thin-reading-multimodal/process-raster-conformance.v1.json",
  import.meta.url
), "utf8"));

const processModalities = ["physics_process", "raster_illustration", "reaction_process"];
const catalog = {
  entries: processModalities.map((modality) => ({
    enabled: true,
    generated: true,
    modality,
    skillId: productionProcessRasterVisualizationCompilers[modality]?.implementation?.skillId
  })),
  version: "liteasy.visualization-builtins/v1"
};

const reservation = {
  artifactId: "artifact-process-1",
  policyRevision: 1,
  reservationId: "reservation-process-1",
  reservedUnits: 1,
  routeId: "route-process-1"
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
    ...(modality === "raster_illustration" ? {
      rasterAsset: {
        assetRef: `raster:${"a".repeat(64)}`,
        byteLength: 1024,
        height: 512,
        labelVerification: { engine: "fixture-ocr/v1", verifiedLabelIds: ["label-1"] },
        mimeType: "image/png",
        sha256: "a".repeat(64),
        width: 512
      }
    } : {}),
    reservation: { ...reservation, artifactId: `artifact-${modality}` },
    source: fixture.source
  };
}

test("provides a production compiler for every process/raster catalog candidate", () => {
  assert.deepEqual(Object.keys(productionProcessRasterVisualizationCompilers).sort(), processModalities);
});

test("rejects provider-supplied raster assets and requires server-owned asset metadata", async () => {
  const registry = new VisualizationArtifactCompilerRegistry({
    catalog,
    compilers: productionProcessRasterVisualizationCompilers
  });
  const proposal = fixture.modalities.raster_illustration.valid;
  await assert.rejects(
    () => registry.compile({
      ...input("raster_illustration", proposal),
      proposal: {
        ...proposal,
        spec: {
          ...proposal.spec,
          payload: { ...proposal.spec.payload, asset: { sha256: "a".repeat(64) } }
        }
      }
    }),
    /visualization_proposal/
  );
  const withoutAsset = input("raster_illustration", proposal);
  delete withoutAsset.rasterAsset;
  await assert.rejects(
    () => registry.compile(withoutAsset),
    /visualization_raster_asset_required/
  );
});

test("compiles valid process/raster conformance proposals", async () => {
  const registry = new VisualizationArtifactCompilerRegistry({
    catalog,
    compilers: productionProcessRasterVisualizationCompilers,
    now: () => new Date("2026-08-11T09:00:00.000Z")
  });
  for (const modality of processModalities) {
    const artifact = await registry.compile(input(modality, fixture.modalities[modality].valid));
    assert.equal(artifact.modality, modality);
    assert.equal(artifact.validation.outcome, "pass");
  }
});

test("rejects schema-valid proposals that fail process/raster hard gates", async () => {
  const registry = new VisualizationArtifactCompilerRegistry({
    catalog,
    compilers: productionProcessRasterVisualizationCompilers,
    now: () => new Date("2026-08-11T09:00:00.000Z")
  });
  for (const modality of processModalities) {
    const invalid = fixture.modalities[modality].invalid.domain;
    const proposal = mergePatch(fixture.modalities[modality].valid, invalid.patch);
    await assert.rejects(
      () => registry.compile(input(modality, proposal)),
      /visualization_hard_validation_failed/
    );
  }
});
