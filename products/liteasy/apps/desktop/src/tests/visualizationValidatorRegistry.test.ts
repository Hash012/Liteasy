import { describe, expect, test } from "vitest";
import type { VisualizationValidator } from "../app/features/visualization/visualizationValidator";
import { runVisualizationValidators } from "../app/features/visualization/visualizationValidator";
import { getVisualizationValidator } from "../app/features/visualization/visualizationValidatorRegistry";
import { accessibilityReadingOrderValidator, evidenceBindingValidator, interactionAllowlistValidator, resourceLimitsValidator } from "../app/features/visualization/validators/baseValidators";
import type { VisualizationValidationContext } from "../app/features/visualization/visualizationValidator";

const context: VisualizationValidationContext = {
  artifactVersion: "liteasy.visualization/v1",
  modality: "semantic_graph",
  spec: {
    modality: "semantic_graph",
    payload: {
      subtype: "flowchart",
      nodes: [{ id: "node-a", kind: "process", label: "A", objectPath: ["node-a"], evidenceClaimIds: ["claim-a"] }],
      edges: [],
      groups: [],
      hierarchy: [],
      timeOrder: [],
      claims: [{ id: "claim-a", text: "Claim A", evidenceIds: ["evidence-a"] }]
    }
  },
  evidenceBindings: [{ claimId: "claim-a", evidenceIds: ["evidence-a"], confidence: "direct" }],
  semanticObjects: [{ objectId: "node-a", kind: "process", label: "A", objectPath: ["node-a"], evidenceClaimIds: ["claim-a"], selectable: true }],
  interaction: { pan: true, zoom: true, rotate: false, playback: "none", parameterIds: [], selectableObjectIds: ["node-a"] },
  accessibility: { summary: "A", objectReadingOrder: ["node-a"] },
  repairCount: 0
};

const contextWithUnknownClaim: VisualizationValidationContext = {
  ...context,
  semanticObjects: [{ ...context.semanticObjects[0], evidenceClaimIds: ["claim-missing"] }]
};

const hardFailure: VisualizationValidator = {
  id: "hard-failure",
  version: "1.0.0",
  gate: "hard",
  validate: async () => ({ gate: "hard", validatorId: "hard-failure", validatorVersion: "1.0.0", outcome: "fail", diagnosticCode: "hard_failure" })
};

const advisoryFailure: VisualizationValidator = {
  id: "advisory-failure",
  version: "1.0.0",
  gate: "advisory",
  validate: async () => ({ gate: "advisory", validatorId: "advisory-failure", validatorVersion: "1.0.0", outcome: "warning", diagnosticCode: "advisory_failure" })
};

describe("visualization validator registry", () => {
test("cannot publish when any hard validator fails", async () => {
    const report = await runVisualizationValidators(context, [hardFailure, advisoryFailure]);
    expect(report.outcome).toBe("fail");
    expect(report.checks.map((check) => check.gate)).toEqual(["hard", "advisory"]);
  });

  test("requires every scientific semantic object to reference a known claim", async () => {
    expect((await evidenceBindingValidator.validate(contextWithUnknownClaim)).outcome).toBe("fail");
  });

  test("rejects empty or payload-only evidence references", async () => {
    expect((await evidenceBindingValidator.validate({ ...context, semanticObjects: [{ ...context.semanticObjects[0], evidenceClaimIds: [] }] })).outcome).toBe("fail");
    expect((await evidenceBindingValidator.validate({ ...context, evidenceBindings: [], semanticObjects: [{ ...context.semanticObjects[0], evidenceClaimIds: ["claim-a"] }] })).outcome).toBe("fail");
  });

  test("only selectable semantic objects may be exposed through interaction", async () => {
    expect((await interactionAllowlistValidator.validate({ ...context, semanticObjects: [{ ...context.semanticObjects[0], selectable: false }] })).outcome).toBe("fail");
  });

  test("requires an exact accessibility reading-order set", async () => {
    expect((await accessibilityReadingOrderValidator.validate({ ...context, accessibility: { ...context.accessibility, objectReadingOrder: ["node-a", "unknown"] } })).outcome).toBe("fail");
  });

  test("counts payload resource limits in UTF-8 bytes", async () => {
    const unicodeContext = { ...context, spec: { ...context.spec, payload: { ...context.spec.payload, nodes: [{ ...context.spec.payload.nodes[0], label: "科学" }] } } };
    expect((await resourceLimitsValidator.validate({ ...unicodeContext, resourceLimits: { maxPayloadBytes: JSON.stringify(unicodeContext.spec).length + 1 } })).outcome).toBe("fail");
  });

  test("exposes base validators to direct registry consumers", () => {
    expect(getVisualizationValidator("evidence-claims")).toBeDefined();
  });
});

test("cannot publish when a hard validator returns a warning", async () => {
  const warningHardValidator: VisualizationValidator = {
    gate: "hard",
    id: "hard-warning",
    validate: async () => ({ gate: "hard", validatorId: "hard-warning", validatorVersion: "1.0.0", outcome: "warning" })
  };
  const report = await runVisualizationValidators(context, [warningHardValidator]);
  expect(report.outcome).toBe("fail");
});

export { context, contextWithUnknownClaim };
