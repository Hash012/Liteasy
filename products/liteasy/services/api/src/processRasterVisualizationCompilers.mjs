import { readFileSync } from "node:fs";
import { validateReactionProcessPayload } from "./reactionProcessValidation.mjs";

const artifactSchema = JSON.parse(readFileSync(new URL(
  "../../../packages/shared/visualizationArtifact.v1.schema.json",
  import.meta.url
), "utf8"));

function pass() {
  return { outcome: "pass" };
}

function fail(diagnosticCode) {
  return { diagnosticCode, outcome: "fail" };
}

function requireEvidence(ids, code) {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error(code);
}

function proposalSchema(modality) {
  const spec = structuredClone(artifactSchema.properties.spec.oneOf.find(
    (candidate) => candidate.properties?.modality?.const === modality
  ));
  if (!spec) throw new Error("visualization_compiler_schema_missing");
  delete spec.properties.payload.properties.asset;
  return {
    additionalProperties: false,
    properties: {
      accessibility: structuredClone(artifactSchema.properties.accessibility),
      evidenceBindings: structuredClone(artifactSchema.properties.evidenceBindings),
      interaction: structuredClone(artifactSchema.properties.interaction),
      semanticObjects: structuredClone(artifactSchema.properties.semanticObjects),
      spec
    },
    required: ["accessibility", "evidenceBindings", "interaction", "semanticObjects", "spec"],
    type: "object"
  };
}

function validatePhysicsProcess({ artifact }) {
  try {
    const payload = artifact.spec.payload;
    if (!Number.isFinite(payload.duration) || payload.duration <= 0 || !Number.isFinite(payload.frameRate) || payload.frameRate <= 0) throw new Error("physics_process_time_invalid");
    if (Math.ceil(payload.duration * payload.frameRate) > 120) throw new Error("physics_process_frame_limit");
    if (!Number.isFinite(payload.errorTolerance) || payload.errorTolerance <= 0) throw new Error("physics_error_tolerance_exceeded");
    requireEvidence(payload.evidenceBindings, "physics_process_evidence_missing");
    for (const value of Object.values(payload.initialState)) {
      if (!Number.isFinite(value)) throw new Error("physics_process_state_invalid");
    }
    for (const parameter of payload.parameters) {
      requireEvidence(parameter.evidenceClaimIds, "physics_process_evidence_missing");
      if (!Number.isFinite(parameter.value) || parameter.value < parameter.min || parameter.value > parameter.max) throw new Error("physics_process_parameter_invalid");
    }
    for (const equation of payload.equations) {
      requireEvidence(equation.evidenceClaimIds, "physics_process_evidence_missing");
      if (/[[\]{};'"]|globalThis|window|document/u.test(equation.expression)) throw new Error("physics_process_expression_invalid");
    }
    for (const invariant of payload.invariants) {
      requireEvidence(invariant.evidenceClaimIds, "physics_process_evidence_missing");
    }
    return pass();
  } catch (error) {
    return fail(error.message);
  }
}

function validateReactionProcess({ artifact }) {
  try {
    validateReactionProcessPayload(artifact.spec.payload);
    return pass();
  } catch (error) {
    return fail(error.message);
  }
}

function validateRasterIllustration({ artifact }) {
  try {
    const payload = artifact.spec.payload;
    requireEvidence(payload.evidenceClaimIds, "raster_evidence_missing");
    if (!Number.isFinite(payload.composition.width) || !Number.isFinite(payload.composition.height) ||
      payload.composition.width <= 0 || payload.composition.height <= 0 ||
      Math.abs(payload.composition.width / payload.composition.height - payload.composition.aspectRatio) > 1e-6) {
      throw new Error("raster_dimensions_invalid");
    }
    if (payload.styleLock?.prohibitDecorativeClaims !== true) throw new Error("raster_style_lock_invalid");
    for (const label of payload.labels) requireEvidence(label.evidenceClaimIds, "raster_evidence_missing");
    if (/(?:https?:|<script|foreignObject)/iu.test(payload.visualSchema)) throw new Error("raster_external_reference");
    const asset = payload.asset;
    if (!asset || typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(asset.sha256) ||
      asset.assetRef !== `raster:${asset.sha256}` || asset.mimeType !== "image/png" ||
      !Number.isSafeInteger(asset.byteLength) || asset.byteLength <= 0 ||
      asset.width !== payload.composition.width || asset.height !== payload.composition.height ||
      !asset.labelVerification || typeof asset.labelVerification.engine !== "string" ||
      !Array.isArray(asset.labelVerification.verifiedLabelIds) ||
      payload.labels.some((label) => !asset.labelVerification.verifiedLabelIds.includes(label.id))) {
      throw new Error("raster_asset_metadata_invalid");
    }
    return pass();
  } catch (error) {
    return fail(error.message);
  }
}

function descriptor({
  kernelId,
  modality,
  rendererId,
  skillId,
  validator
}) {
  return {
    hardValidators: [{ id: `${modality.replaceAll("_", "-")}-hard`, validate: validator, version: "1.0.0" }],
    implementation: {
      ...(kernelId ? { kernelId, kernelVersion: "1.0.0" } : {}),
      rendererId,
      rendererVersion: "1.0.0",
      skillId,
      skillVersion: "1.0.0"
    },
    modality,
    proposalSchema: proposalSchema(modality)
  };
}

export const productionProcessRasterVisualizationCompilers = Object.freeze({
  physics_process: descriptor({
    kernelId: "physics-process-v1",
    modality: "physics_process",
    rendererId: "physics-process-svg",
    skillId: "physics-process",
    validator: validatePhysicsProcess
  }),
  raster_illustration: descriptor({
    modality: "raster_illustration",
    rendererId: "raster-illustration-svg",
    skillId: "raster-illustration",
    validator: validateRasterIllustration
  }),
  reaction_process: descriptor({
    kernelId: "reaction-process-v1",
    modality: "reaction_process",
    rendererId: "reaction-process-svg",
    skillId: "reaction-process",
    validator: validateReactionProcess
  })
});
