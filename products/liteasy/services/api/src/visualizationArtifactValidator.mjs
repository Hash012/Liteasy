import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";

const artifactStates = new Set(["ready", "degraded", "pending_revalidation", "hidden"]);
const identifierPattern = /^[A-Za-z0-9._:-]{1,160}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const artifactSchema = JSON.parse(readFileSync(new URL(
  "../../../packages/shared/visualizationArtifact.v1.schema.json",
  import.meta.url
), "utf8"));
const ajv = new Ajv2020({ allErrors: false, strict: true });
ajv.addFormat("date-time", {
  type: "string",
  validate(value) {
    return Number.isFinite(Date.parse(value));
  }
});
const validateArtifactBody = ajv.compile(artifactSchema);

function pass() {
  return {
    outcome: "pass",
    validatorVersions: { structure: "1" }
  };
}

function fail(reasonCode) {
  return {
    outcome: "fail",
    reasonCode,
    validatorVersions: { structure: "1" }
  };
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateVisualizationArtifact(input) {
  if (input?.phase === "provider_result") {
    const result = input.providerResult;
    if (!plainObject(result)) return fail("provider_result_invalid");
    if (typeof result.text === "string" && result.text.trim() !== "") return pass();
    if (typeof result.mimeType === "string" && /^image\/[a-z0-9.+-]+$/i.test(result.mimeType) &&
      (typeof result.data === "string" || result.bytes instanceof Uint8Array)) return pass();
    return fail("provider_result_invalid");
  }
  if (input?.phase !== "publication" || !plainObject(input.artifact)) {
    return fail("artifact_invalid");
  }
  const artifact = input.artifact;
  if (!identifierPattern.test(artifact.artifactId ?? "") ||
    (artifact.nodeId != null && !identifierPattern.test(artifact.nodeId)) ||
    artifact.modality !== input.modality || !artifactStates.has(artifact.state) ||
    !hashPattern.test(artifact.specHash ?? "") || !hashPattern.test(artifact.evidenceHash ?? "") ||
    (artifact.contentHash != null && !hashPattern.test(artifact.contentHash)) || !plainObject(artifact.body)) {
    return fail("artifact_invalid");
  }
  if (!validateArtifactBody(artifact.body)) {
    return fail("artifact_schema_invalid");
  }
  if (artifact.body.artifactId !== artifact.artifactId || artifact.body.nodeId !== artifact.nodeId) {
    return fail("artifact_identity_invalid");
  }
  if (artifact.body.modality !== input.modality || artifact.body.spec?.modality !== artifact.body.modality) {
    return fail("artifact_modality_invalid");
  }
  if (artifact.body.validation?.outcome === "fail" ||
    !artifact.body.validation?.checks?.some((check) => check.gate === "hard") ||
    artifact.body.validation.checks.some((check) => check.gate === "hard" && check.outcome !== "pass")) {
    return fail("artifact_hard_gate_invalid");
  }
  return pass();
}
