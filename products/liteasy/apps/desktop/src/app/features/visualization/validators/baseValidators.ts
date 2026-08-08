import type { VisualizationValidationCheck, VisualizationValidationContext, VisualizationValidator } from "../visualizationValidator";

const stableIdPattern = /^[A-Za-z][A-Za-z0-9_-]*$/;

function check(validatorId: string, version: string, gate: "hard" | "advisory", outcome: VisualizationValidationCheck["outcome"], diagnosticCode?: string): VisualizationValidationCheck {
  return { gate, validatorId, validatorVersion: version, outcome, ...(diagnosticCode ? { diagnosticCode } : {}) };
}

export const schemaIdentityValidator: VisualizationValidator = {
  id: "schema-identity",
  version: "1.0.0",
  gate: "hard",
  validate: (context) => check("schema-identity", "1.0.0", "hard", context.artifactVersion === "liteasy.visualization/v1" && context.modality === context.spec.modality ? "pass" : "fail", "visualization_schema_identity_invalid")
};

export const evidenceBindingValidator: VisualizationValidator = {
  id: "evidence-claims",
  version: "1.0.0",
  gate: "hard",
  validate: (context) => {
    const knownClaims = new Set(context.evidenceBindings.map((binding) => binding.claimId));
    const valid = context.semanticObjects.every((object) => object.evidenceClaimIds.length > 0 && object.evidenceClaimIds.every((claimId) => knownClaims.has(claimId)));
    return check("evidence-claims", "1.0.0", "hard", valid ? "pass" : "fail", "visualization_evidence_claim_missing");
  }
};

export const stableObjectIdsValidator: VisualizationValidator = {
  id: "stable-object-ids",
  version: "1.0.0",
  gate: "hard",
  validate: (context) => {
    const ids = context.semanticObjects.map((object) => object.objectId);
    const valid = ids.every((id) => stableIdPattern.test(id)) && new Set(ids).size === ids.length;
    return check("stable-object-ids", "1.0.0", "hard", valid ? "pass" : "fail", "visualization_object_id_invalid");
  }
};

export const interactionAllowlistValidator: VisualizationValidator = {
  id: "interaction-allowlist",
  version: "1.0.0",
  gate: "hard",
  validate: (context) => {
    const selectableIds = new Set(context.semanticObjects.filter((object) => object.selectable).map((object) => object.objectId));
    const valid = context.interaction.selectableObjectIds.every((id) => selectableIds.has(id)) && new Set(context.interaction.selectableObjectIds).size === context.interaction.selectableObjectIds.length;
    return check("interaction-allowlist", "1.0.0", "hard", valid ? "pass" : "fail", "visualization_interaction_allowlist_invalid");
  }
};

export const resourceLimitsValidator: VisualizationValidator = {
  id: "resource-limits",
  version: "1.0.0",
  gate: "hard",
  validate: (context) => {
    const limits = context.resourceLimits ?? {};
    const payloadBytes = new TextEncoder().encode(JSON.stringify(context.spec)).byteLength;
    const valid = context.semanticObjects.length <= (limits.maxSemanticObjects ?? 512) &&
      context.evidenceBindings.length <= (limits.maxEvidenceBindings ?? 256) &&
      payloadBytes <= (limits.maxPayloadBytes ?? 2_000_000);
    return check("resource-limits", "1.0.0", "hard", valid ? "pass" : "fail", "visualization_resource_limit_exceeded");
  }
};

export const sourceFigureIdentityValidator: VisualizationValidator = {
  id: "source-figure-identity",
  version: "1.0.0",
  gate: "hard",
  validate: (context) => {
    if (context.modality !== "source_figure") return check("source-figure-identity", "1.0.0", "hard", "pass");
    if (context.spec.modality !== "source_figure") return check("source-figure-identity", "1.0.0", "hard", "pass");
    const payload = context.spec.payload;
    const valid = payload.sourceFigureId.length > 0 && context.evidenceBindings.some((binding) => binding.sourceFigureId === payload.sourceFigureId);
    return check("source-figure-identity", "1.0.0", "hard", valid ? "pass" : "fail", "source_figure_identity_missing");
  }
};

export const accessibilityReadingOrderValidator: VisualizationValidator = {
  id: "accessibility-reading-order",
  version: "1.0.0",
  gate: "hard",
  validate: (context) => {
    const ids = context.semanticObjects.map((object) => object.objectId);
    const order = context.accessibility.objectReadingOrder;
    const valid = new Set(order).size === order.length && order.length === ids.length && ids.every((id) => order.includes(id));
    return check("accessibility-reading-order", "1.0.0", "hard", valid ? "pass" : "fail", "accessibility_reading_order_invalid");
  }
};

export const baseVisualizationValidators: readonly VisualizationValidator[] = [
  schemaIdentityValidator,
  evidenceBindingValidator,
  stableObjectIdsValidator,
  interactionAllowlistValidator,
  resourceLimitsValidator,
  sourceFigureIdentityValidator,
  accessibilityReadingOrderValidator
];
